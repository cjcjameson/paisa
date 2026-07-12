package server

import (
	"sort"
	"strings"
	"time"

	"github.com/ananthakumaran/paisa/internal/model/posting"
	"github.com/ananthakumaran/paisa/internal/query"
	"github.com/ananthakumaran/paisa/internal/service"
	"github.com/ananthakumaran/paisa/internal/utils"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/shopspring/decimal"
	"gorm.io/gorm"
)

type IncomeStatement struct {
	StartingBalance decimal.Decimal            `json:"startingBalance"`
	EndingBalance   decimal.Decimal            `json:"endingBalance"`
	Date            time.Time                  `json:"date"`
	Income          map[string]decimal.Decimal `json:"income"`
	Interest        map[string]decimal.Decimal `json:"interest"`
	Equity          map[string]decimal.Decimal `json:"equity"`
	Pnl             map[string]decimal.Decimal `json:"pnl"`
	Assets          map[string]decimal.Decimal `json:"assets"`
	AssetsNonCash   map[string]decimal.Decimal `json:"assets_noncash"`
	Liabilities     map[string]decimal.Decimal `json:"liabilities"`
	Tax             map[string]decimal.Decimal `json:"tax"`
	Expenses        map[string]decimal.Decimal `json:"expenses"`
}

type RunningBalance struct {
	amount   decimal.Decimal
	quantity map[string]decimal.Decimal
}

// A transaction "moved cash" if any of its legs touched a liquid account
// (checking or a credit card) — or an Equity:Transfers:* bucket, which is by
// convention one half of a two-transaction inter-account cash movement (e.g.
// a Vanguard sale whose matching deposit into Schwab is a separate
// transaction). Asset deltas inside such transactions are real cash
// buys/sells; asset deltas in transactions with NO cash-connected leg are
// book moves — dividend reinvestments, payroll contributions, vests, opening
// balances — and belong in AssetsNonCash so the cash-flow walk can ignore
// them at the source. (Internal transfers between two investment accounts
// also ride Equity:Transfers, so they count as a symmetric buy+sell; they
// cancel in the walk.)
func isCashConnected(account string) bool {
	return strings.HasPrefix(account, "Assets:Checking") ||
		strings.HasPrefix(account, "Liabilities:CreditCards") ||
		strings.HasPrefix(account, "Liabilities:Credit_Cards") ||
		strings.HasPrefix(account, "Liabilities:Courtney:BusinessCard") ||
		strings.HasPrefix(account, "Equity:Transfers")
}

func GetIncomeStatement(db *gorm.DB) gin.H {
	postings := query.Init(db).All()

	liquidTxns := make(map[string]bool)
	for _, p := range postings {
		if isCashConnected(p.Account) {
			liquidTxns[p.TransactionID] = true
		}
	}

	yearly := computeStatement(db, liquidTxns, utils.GroupByFY(postings), func(fy string) (time.Time, time.Time) {
		return utils.ParseFY(fy)
	})
	// Monthly buckets ("2006-01" keys) let the frontend aggregate any
	// contiguous 1-12 month range; startingBalance chains across months the
	// same way it chains across years.
	monthly := computeStatement(db, liquidTxns, utils.GroupByMonth(postings), func(month string) (time.Time, time.Time) {
		start, err := time.Parse("2006-01", month)
		if err != nil {
			return time.Time{}, time.Time{}
		}
		return start, start.AddDate(0, 1, -1)
	})
	return gin.H{"yearly": yearly, "monthly": monthly}
}

func computeStatement(db *gorm.DB, liquidTxns map[string]bool, grouped map[string][]posting.Posting, bounds func(key string) (time.Time, time.Time)) map[string]IncomeStatement {
	statements := make(map[string]IncomeStatement)

	fys := lo.Keys(grouped)
	sort.Strings(fys)

	runnings := make(map[string]RunningBalance)
	startingBalance := decimal.Zero

	for _, fy := range fys {
		incomeStatement := IncomeStatement{}
		start, end := bounds(fy)
		incomeStatement.Date = start
		incomeStatement.StartingBalance = startingBalance
		incomeStatement.Income = make(map[string]decimal.Decimal)
		incomeStatement.Interest = make(map[string]decimal.Decimal)
		incomeStatement.Equity = make(map[string]decimal.Decimal)
		incomeStatement.Pnl = make(map[string]decimal.Decimal)
		incomeStatement.Assets = make(map[string]decimal.Decimal)
		incomeStatement.AssetsNonCash = make(map[string]decimal.Decimal)
		incomeStatement.Liabilities = make(map[string]decimal.Decimal)
		incomeStatement.Tax = make(map[string]decimal.Decimal)
		incomeStatement.Expenses = make(map[string]decimal.Decimal)

		for _, p := range grouped[fy] {

			category := utils.FirstName(p.Account)

			switch category {
			case "Income":
				if service.IsCapitalGains(p) {
					sourceAccount := service.CapitalGainsSourceAccount(p.Account)
					r := runnings[sourceAccount]
					if r.quantity == nil {
						r.quantity = make(map[string]decimal.Decimal)
					}
					r.amount = r.amount.Add(p.Amount)
					runnings[sourceAccount] = r
				} else if strings.HasPrefix(p.Account, "Income:Interest") {
					incomeStatement.Interest[p.Account] = incomeStatement.Interest[p.Account].Add(p.Amount)
				} else {
					incomeStatement.Income[p.Account] = incomeStatement.Income[p.Account].Add(p.Amount)
				}
			case "Equity":
				incomeStatement.Equity[p.Account] = incomeStatement.Equity[p.Account].Add(p.Amount)
			case "Expenses":
				if strings.HasPrefix(p.Account, "Expenses:Tax") {
					incomeStatement.Tax[p.Account] = incomeStatement.Tax[p.Account].Add(p.Amount)
				} else {
					incomeStatement.Expenses[p.Account] = incomeStatement.Expenses[p.Account].Add(p.Amount)
				}
			case "Liabilities":
				incomeStatement.Liabilities[p.Account] = incomeStatement.Liabilities[p.Account].Add(p.Amount)
			case "Assets":
				r := runnings[p.Account]
				if r.quantity == nil {
					r.quantity = make(map[string]decimal.Decimal)
				}
				r.amount = r.amount.Add(p.Amount)
				r.quantity[p.Commodity] = r.quantity[p.Commodity].Add(p.Quantity)
				runnings[p.Account] = r

				if isCashConnected(p.Account) || liquidTxns[p.TransactionID] {
					incomeStatement.Assets[p.Account] = incomeStatement.Assets[p.Account].Add(p.Amount)
				} else {
					incomeStatement.AssetsNonCash[p.Account] = incomeStatement.AssetsNonCash[p.Account].Add(p.Amount)
				}
			default:
				// ignore
			}
		}

		for account, r := range runnings {
			diff := r.amount.Neg()
			for commodity, quantity := range r.quantity {
				diff = diff.Add(service.GetPrice(db, commodity, quantity, end))
			}
			incomeStatement.Pnl[account] = diff

			r.amount = r.amount.Add(diff)
			runnings[account] = r
		}

		// Net worth accumulation. Per double entry, each year's asset change
		// equals -(income + equity + expenses + tax + liabilities), so summing
		// the negated flow categories plus pnl yields assets at market AND the
		// liability change already folded in. The old extra
		// `Liabilities.Neg()` term cancelled that fold-in, making the headline
		// assets-only (net worth overstated by total debt, ~$330k).
		sumBalance(incomeStatement.Liabilities) // prune zero entries only
		startingBalance = startingBalance.
			Add(sumBalance(incomeStatement.Income).Neg()).
			Add(sumBalance(incomeStatement.Interest).Neg()).
			Add(sumBalance(incomeStatement.Equity).Neg()).
			Add(sumBalance(incomeStatement.Tax).Neg()).
			Add(sumBalance(incomeStatement.Expenses).Neg()).
			Add(sumBalance(incomeStatement.Pnl))

		incomeStatement.EndingBalance = startingBalance

		statements[fy] = incomeStatement
	}

	return statements
}

func sumBalance(breakdown map[string]decimal.Decimal) decimal.Decimal {
	total := decimal.Zero
	for k, v := range breakdown {
		total = total.Add(v)

		if v.Equal(decimal.Zero) {
			delete(breakdown, k)
		}
	}
	return total
}
