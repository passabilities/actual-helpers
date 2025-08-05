import * as api from '@actual-app/api'
import { AccountEntity, RuleEntity, TransactionEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'
import { ensureCategory, ensureCategoryGroup, ensurePayee, getAccountBalance, getLastTransaction } from './utils'

export default async function calcPayments(accounts: AccountEntity[]) {
  for (const account of accounts) {
    const currentBalance = await getAccountBalance(account);
    if (account.offbudget || currentBalance >= 0) continue;
    await calcNextPayment(account);
  }
}

async function calcNextPayment(account: AccountEntity) {
  const ccPaymentCategoryId = await ensureCategory('💳 Credit Card Payment', await ensureCategoryGroup('Transfers'));

  const lastPayment = await getLastTransaction(account, undefined, { category: ccPaymentCategoryId })
  if (lastPayment) {
    const targetAmount = -lastPayment.amount;
    const lastPaymentDate = dayjs.utc(lastPayment.date)

    const txs: TransactionEntity[] = await api.getTransactions(
      account.id,
      lastPaymentDate.subtract(90, 'days').format('YYYY-MM-DD'),
      dayjs.utc().format('YYYY-MM-DD')
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
    function findConsecutiveSequence(transactions: TransactionEntity[], target: number): { start: number, end: number } | void {
      for (let start = 0; start < transactions.length; start++) {
        let currentSum = 0;

        let paymentTxs: number[] = []
        for (let end = start; end < transactions.length; end++) {
          const tx = transactions[end];

          if (tx.category === ccPaymentCategoryId) {
            paymentTxs.push(end)
            if (paymentTxs.length == 1) {
              continue
            }
          }

          currentSum += tx.amount

          // If we've found a match that's not a single transaction
          if (currentSum == target) {
            const diff = dayjs.utc(lastPaymentDate).diff(tx.date, 'days')
            if (paymentTxs.length === 0 || diff > 30) {
              break
            }
            return { start, end }
          }
        }
      }
    }

    // Find all possible combinations that sum to the target amount
    const combination = findConsecutiveSequence(eligibleTxs, targetAmount);
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
          { date: { $gt: dueStart.format('YYYY-MM-DD') } }
        ]
      }
      const dueBalance = await getAccountBalance(account, balanceFilter);
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
      .select(['id'])
  ) as { data: { id: string }[] };

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
    value: args.dueBalance
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
    }
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
        .select(['rule'])
    ) as { data: { rule: string }[] };
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