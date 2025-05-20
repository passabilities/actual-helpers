const api = require('@actual-app/api');
const { closeBudget, ensureCategory, ensureCategoryGroup, ensurePayee, getAccountBalance, getAccountNote, getSimpleFinID, getSimpleFinAccounts, getTransactions, getLastTransaction, openBudget } = require('./utils');
require("dotenv").config();

const shouldDrop = (payment) => {
  const note = payment.notes;
  return note && (note.indexOf('YOU BOUGHT ') > -1 || note == 'Buy Other' || note == 'Sell Other');
};

const zeroTransaction = async (payment) => {
  await api.updateTransaction(
    payment.id,
    { 'amount': 0 }
  );
}

(async () => {
  await openBudget();

  const payeeId = await ensurePayee(process.env.INVESTMENT_PAYEE_NAME || 'Investment');
  const categoryGroupId = await ensureCategoryGroup(process.env.INVESTMENT_CATEGORY_GROUP_NAME || 'Income');
  const categoryId = await ensureCategory(process.env.INVESTMENT_CATEGORY_NAME || 'Investment', categoryGroupId, true);

  const simpleFinAccounts = await getSimpleFinAccounts();

  const accounts = await api.getAccounts();
  for (const account of accounts) {
    if (account.closed) {
      continue;
    }

    const note = await getAccountNote(account);
    if (note) {
      const data = await getTransactions(account);

      // if (note.indexOf('zeroSmall') > -1) {
      //   const payments = data.filter(payment => payment.amount > -10000 && payment.amount < 10000 && payment.amount != 0 && payment.category == categoryId)
      //   for (const payment of payments) {
      //     if (shouldDrop(payment)) {
      //       await zeroTransaction(payment);
      //     }
      //   }
      // }
      //
      // if (note.indexOf('dropPayments') > -1) {
      //   const payments = data.filter(payment => payment.amount < 0)
      //   for (const payment of payments) {
      //     if (shouldDrop(payment)) {
      //       await zeroTransaction(payment);
      //     }
      //   }
      // }

      if (note.indexOf('calcInvestment') > -1) {
        const simpleFinID = await getSimpleFinID(account);
        const simpleFinAccount = simpleFinAccounts.find(a => a.id === simpleFinID);
        if (!simpleFinAccount) {
          console.error(`Could not find SimpleFin account for '${account.name}'`)
          continue
        }

        const simpleFinBalance = parseInt(parseFloat(simpleFinAccount.balance) * 100);
        const currentBalance = await getAccountBalance(account);
        const diff = simpleFinBalance - currentBalance;

        console.log('Account:', account.name);
        console.log('SimpleFin Balance:', simpleFinBalance);
        console.log('Current Balance:', currentBalance);
        console.log('Difference:', diff);

        if (diff) {
          const lastTx = await getLastTransaction(account, undefined,true, { $like: 'Update investment balance to %' })
          const shouldUpdateTx = lastTx && new RegExp(`^${lastTx.date}T`).test(new Date().toISOString())

          const newNote = `Update investment balance to ${simpleFinBalance / 100}`

          if (shouldUpdateTx) {
            await api.updateTransaction(lastTx.id, {
              amount: +lastTx.amount + diff,
              notes: newNote,
            })
          } else {
            await api.importTransactions(account.id, [{
              date: new Date(),
              payee: payeeId,
              amount: diff,
              cleared: true,
              reconciled: true,
              category: categoryId,
              notes: newNote,
            }]);
          }
        }
      }
    }
  }

  await closeBudget();
})();
