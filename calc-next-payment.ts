import * as api from '@actual-app/api'
import { AccountEntity, RuleEntity, TransactionEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'
import { Duration } from 'dayjs/plugin/duration'
import {
  ensureCategory,
  ensureCategoryGroup,
  ensurePayee,
  getAccountBalance, getAccountNote,
  getLastTransaction, getTagValue,
  getTransactions,
} from './utils'

export default async function calcPayments(accounts: AccountEntity[]) {
  for (const account of accounts) {
    const currentBalance = await getAccountBalance(account)
    if (account.offbudget || currentBalance >= 0) continue
    // await calcNextPayment(account)


    const payments = await getTransactions(account, {
      filter: { category: await getCCPaymentCategory() },
      limit: 6,
      // offset: 1,
    })
    const paymentDates = payments.map(tx => dayjs.utc(tx.date))

    // const avgCycleDuration = await calculateAverageCycleDuration(paymentDates)
    const avgCycleDuration = dayjs.duration(1, 'month')
    const nextPaymentDate = paymentDates[0].add(avgCycleDuration)

    const txs = await getTransactions(account, {
      filter: {
        category: { $ne: await getCCPaymentCategory() },
        date: { $gte: dayjs.utc().subtract(8, 'months').format('YYYY-MM-DD') },
      },
    })

    const note = await getAccountNote(account)
    const daysAfterStatementClose = getTagValue(note, 'statementClose', '15')!
    const statements = await generateStatementPeriods(payments, dayjs.duration(+daysAfterStatementClose, 'days'))

    let initialTxIndex = 0
    for (let i = 0; i < statements.length; i++) {
      const statement = statements[i]
      const prevStatement = statements[i + 1]
      if (!prevStatement) {
        break
      }

      const prevPaymentDate = prevStatement.payment.date

      let statementBalanceTxs: TransactionEntity[]
      const statementChargesTxs: TransactionEntity[] = []

      const sequence = findConsecutiveSequence(txs, -statement.payment.amount)
      console.log('sequence', sequence)

      // for (let end = initialTxIndex; end < txs.length; end++) {
      //   // tx must be before the payment
      //   if (dayjs.utc(txs[end].date).isAfter(statement.payment.date, 'days')) {
      //     continue
      //   }
      //
      //   let charges = 0
      //   let credits = 0
      //   statementBalanceTxs = []
      //
      //   for (let start = end; start < txs.length; start++) {
      //     // check if we have gone too far
      //     if (
      //       // tx must be within 30 days of the previous payment
      //       prevPaymentDate.subtract(30, 'days').isAfter(dayjs.utc(txs[start].date), 'days')
      //     ) {
      //       break
      //     }
      //
      //     if (txs[start].amount < 0) {
      //       charges += txs[start].amount
      //     } else {
      //       credits += txs[start].amount
      //     }
      //
      //     statementBalanceTxs.push(txs[start])
      //
      //     // console.log(1 -Math.abs((charges + credits) / statement.payment.amount))
      //     // if (Math.abs(1 - ((charges + credits) / statement.payment.amount)) < 0.05) {
      //     //   console.log({
      //     //     statementAmount: statement.payment.amount,
      //     //     txAmount: charges + credits,
      //     //   })
      //     // }
      //
      //     if (charges + credits === -statement.accruedAmount) {
      //       initialTxIndex = start + 1
      //       break
      //     }
      //   }
      //
      //   if (charges + credits === -statement.accruedAmount) {
      //     break
      //   }
      // }
    }

    // const likelyStatementEndDate = inferLikelyStatementEndDate(payments, avgCycleDuration)
    console.log({
      account: account.name,
      avgCycleDuration: avgCycleDuration.asDays(),
      nextPaymentDate: nextPaymentDate.format('YYYY-MM-DD'),
      // likelyStatementEndDate,
    })

    return
  }
}

const getCCPaymentCategory = async () =>
  ensureCategory('💳 Credit Card Payment', await ensureCategoryGroup('Transfers'))

const calculateAverageCycleDuration = async (paymentDates: dayjs.Dayjs[]) => {
  if (paymentDates.length < 2) {
    throw new Error('Not enough payments')
  }

  let acc = 0
  for (let i = 1; i < paymentDates.length; i++) {
    acc += paymentDates[i - 1].diff(paymentDates[i], 'days')
  }
  return dayjs.duration(Math.round(acc / (paymentDates.length - 1)), 'days')
}

interface Statement {
  start: dayjs.Dayjs
  end: dayjs.Dayjs
  accruedAmount: number
  prevBalance: number
  newBalance: number
  payment: {
    date: dayjs.Dayjs
    amount: number
  }
}

interface CalculateStatementsConfig {
  count: number
}

const generateStatementPeriods = async (payments: TransactionEntity[], daysAfterClose: Duration): Promise<Statement[]> => {
  return Promise.all(
    payments.map(async (payment, i) => {
      const paymentDate = dayjs.utc(payment.date)
      const closeDate = paymentDate.subtract(daysAfterClose)
      const openDate = paymentDate.subtract(daysAfterClose.add(1, 'month'))

      const { data: credits } = await api.aqlQuery(
        api.q('transactions')
          .filter({
            $and: [
              { account: payment.account },
              // { category: { $ne: await getCCPaymentCategory() } },
              { amount: { $gt: 0 } },
              { date: { $lte: closeDate.format('YYYY-MM-DD') } },
              { date: { $gte: openDate.format('YYYY-MM-DD') } },
            ]
          })
          .calculate({ $sum: '$amount' })
      ) as { data: number };
      const { data: charges } = await api.aqlQuery(
        api.q('transactions')
          .filter({
            $and: [
              { account: payment.account },
              // { category: { $ne: await getCCPaymentCategory() } },
              { amount: { $lt: 0 } },
              { date: { $lte: closeDate.format('YYYY-MM-DD') } },
              { date: { $gte: openDate.format('YYYY-MM-DD') } },
            ]
          })
          .calculate({ $sum: '$amount' })
      ) as { data: number };

      const newBalance = -payment.amount
      const prevPayment = -payments[i + 1]?.amount || 0
      const accruedAmount = charges + credits
      const prevBalance = newBalance + prevPayment + accruedAmount
      // const newBalance = accruedAmount - prevBalance
      // const prevBalance = newBalance + credits - charges

      return {
        start: dayjs.utc(),
        end: dayjs.utc(),
        accruedAmount,
        prevBalance,
        newBalance,
        payment: {
          date: paymentDate,
          amount: payment.amount
        },
      }
    })
  )
}

// const inferLikelyStatementEndDate = (payments: TransactionEntity[], avgCycleDuration: Duration) => {
//   const offsets = payments.map(p => {
//     const d = dayjs.utc(p.date)
//     return ((d.subtract(avgCycleDuration).date() + 31) % 31) || 31 // modulo offset wrap
//   })
//
//   const histogram: Record<number, number> = {}
//   for (const day of offsets) {
//     const rounded = Math.round(day)
//     histogram[rounded] = (histogram[rounded] || 0) + 1
//   }
//
//   const [mostCommonDay] = Object.entries(histogram).sort((a, b) => b[1] - a[1])[0]
//   return parseInt(mostCommonDay)
// }




















function findConsecutiveSequence(transactions: TransactionEntity[], target: number): {
  start: number,
  end: number
} | void {
  for (let start = 0; start < transactions.length; start++) {
    let currentSum = 0

    for (let end = start; end < transactions.length; end++) {
      const tx = transactions[end]

      currentSum += tx.amount

      // If we've found a match that's not a single transaction
      if (currentSum == target) {
        return { start, end }
      }
    }
  }
}






async function calcNextPayment(account: AccountEntity) {
  const ccPaymentCategoryId = await ensureCategory('💳 Credit Card Payment', await ensureCategoryGroup('Transfers'))

  const lastPayment = await getLastTransaction(account, undefined, { category: ccPaymentCategoryId })
  if (lastPayment) {
    const targetAmount = -lastPayment.amount
    const lastPaymentDate = dayjs.utc(lastPayment.date)

    const txs: TransactionEntity[] = await api.getTransactions(
      account.id,
      lastPaymentDate.subtract(90, 'days').format('YYYY-MM-DD'),
      dayjs.utc().format('YYYY-MM-DD'),
    )

    // Filter and validate transactions
    const eligibleTxs = txs
      .reverse()
    // .filter(tx => {
    //   const diff = lastPaymentDate.diff(dayjs.utc(tx.date), 'days')
    //   return diff >= 15
    //   // return dayjs.utc(tx.date).isBefore(lastPayment.date, 'day');
    // })

    // Function to find all consecutive sequences of transactions that sum to the target amount

    // Find all possible combinations that sum to the target amount
    const combination = findConsecutiveSequence(eligibleTxs, targetAmount)
    if (combination) {
      const dueStart = dayjs.utc(eligibleTxs[combination.end].date)
      let nextDueDate = lastPaymentDate.add(1, 'month')
      while (nextDueDate.isBefore(dayjs.utc(), 'day')) {
        nextDueDate = nextDueDate.add(1, 'month')
      }
      const balanceFilter = {
        $and: [
          { category: { $ne: ccPaymentCategoryId } },
          { date: { $lt: nextDueDate.format('YYYY-MM-DD') } },
          { date: { $gt: dueStart.format('YYYY-MM-DD') } },
        ],
      }
      const dueBalance = await getAccountBalance(account, balanceFilter)
      console.log()
      console.log(`Account: ${account.name}`)
      console.log(`Balance Due: $${(dueBalance / 100).toFixed(2)}`)
      console.log(`Due Date: ${nextDueDate.format('YYYY-MM-DD')}`)

      const scheduleId = await ensureSchedule({
        dueDate: nextDueDate,
        dueBalance,
        accountName: account.name,
      })

      await fixScheduleRule({
        scheduleId,
        categoryId: ccPaymentCategoryId,
        accountName: account.name,
      })
    } else {
      // console.log('No exact combination of transactions found that matches the payment amount.');
      //
      // // Find the closest combination if no exact match
      // let closestSum = 0;
      // let closestCombination: TransactionEntity[] = [];
      //
      // function findClosestSubset(transactions: TransactionEntity[], target: number) {
      //   const n = transactions.length;
      //   // Sort transactions by amount (ascending) to prioritize smaller transactions
      //   const sortedTxs = [...transactions].sort((a, b) => a.amount - b.amount);
      //
      //   // Initialize variables to track the best solution
      //   let minDiff = Infinity;
      //   let bestSum = 0;
      //   let bestCombination: TransactionEntity[] = [];
      //
      //   // Try all possible combinations using bitmask
      //   const totalCombinations = 1 << n;
      //
      //   for (let mask = 1; mask < totalCombinations; mask++) {
      //     let currentSum = 0;
      //     const currentCombination: TransactionEntity[] = [];
      //
      //     // Calculate sum for current combination
      //     for (let i = 0; i < n; i++) {
      //       if (mask & (1 << i)) {
      //         currentSum += sortedTxs[i].amount;
      //         currentCombination.push(sortedTxs[i]);
      //       }
      //     }
      //
      //     // Check if this is a better solution
      //     const diff = Math.abs(currentSum - target);
      //     if (diff < minDiff || (diff === minDiff && currentSum > bestSum)) {
      //       minDiff = diff;
      //       bestSum = currentSum;
      //       bestCombination = [...currentCombination];
      //     }
      //
      //     // Early exit if we found an exact match
      //     if (minDiff === 0) break;
      //   }
      //
      //   closestSum = bestSum;
      //   closestCombination = bestCombination;
      // }
      //
      // findClosestSubset(eligibleTxs, targetAmount);
      //
      // if (closestCombination.length > 0) {
      //   console.log(`\nClosest combination found ($${(closestSum / 100).toFixed(2)} of $${(targetAmount / 100).toFixed(2)}):`);
      //   closestCombination.forEach(tx => {
      //     console.log(`- ${tx.date} | ${tx.notes} | $${(tx.amount / 100).toFixed(2)}`);
      //   });
      //   console.log(`Difference: $${((targetAmount - closestSum) / 100).toFixed(2)}`);
      // } else {
      //   console.log('No suitable combination of transactions found.');
      // }
    }
  }
}

interface EnsureScheduleArgs {
  accountName: string
  dueDate: dayjs.Dayjs
  dueBalance: number
}

const ensureSchedule = async (args: EnsureScheduleArgs): Promise<string> => {
  const scheduleName = `CC Statement Due for ${args.accountName}`
  const { data: existingSchedules } = await api.aqlQuery(
    api.q('schedules')
      .filter({ name: scheduleName })
      .select([ 'id' ]),
  ) as { data: { id: string }[] }

  const joinCheckingAccountCondition = {
    op: 'is',
    field: 'account',
    value: '65336329-0877-4395-be4b-dc9ca7faa8a7', // Joint Checking
  }
  const dueDateCondition = {
    op: 'is',
    field: 'date',
    value: {
      frequency: 'monthly',
      start: args.dueDate.format('YYYY-MM-DD'),
      endMode: 'never',
      // patterns: [],
      // skipWeekend: false,
      // weekendSolveMode: 'after',
    },
  }
  const amountDueCondition = {
    op: 'isapprox',
    field: 'amount',
    value: args.dueBalance,
  }

  const scheduleId: string = await api.internal.send(
    existingSchedules.length > 0 ? 'schedule/update' : 'schedule/create',
    {
      schedule: {
        id: existingSchedules.length > 0 ? existingSchedules[0].id : undefined,
        name: scheduleName,
      },
      conditions: [
        joinCheckingAccountCondition,
        dueDateCondition,
        amountDueCondition,
      ],
    },
  )

  return scheduleId
}

interface FixScheduleRuleArgs {
  scheduleId: string
  categoryId: string
  accountName: string
}

const fixScheduleRule = async (args: FixScheduleRuleArgs) => {
  const rule: RuleEntity = await api.getRules().then(async (rules: RuleEntity[]) => {
    const { data: [ schedule ] } = await api.aqlQuery(
      api.q('schedules')
        .filter({ id: args.scheduleId })
        .select([ 'rule' ]),
    ) as { data: { rule: string }[] }
    return rules.find((rule) => rule.id === schedule.rule)!
  })
  const linkAction = rule.actions.find((action) => action.op === 'link-schedule')
  rule.actions = []
  if (linkAction) rule.actions.push(linkAction)
  rule.actions.push({
    op: 'set',
    field: 'category',
    value: args.categoryId,
  })
  rule.actions.push({
    op: 'set',
    field: 'payee',
    value: await ensurePayee(`CC Payment for ${args.accountName}`),
  })
  await api.updateRule(rule)
}