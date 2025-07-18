import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'

import {
  dateToNumber,
  getAccountNote,
  getSimpleFinAccounts,
  getSimpleFinID,
  getTagValue,
  updateAccountBalance,
} from './utils'

export default async function syncBalance(accounts: AccountEntity[]) {
  for (const account of accounts) {
    if (account.closed) continue;

    const note = await getAccountNote(account);
    if (!note) continue;

    const syncType = getTagValue(note, 'sync');
    if (!syncType) continue;

    const simpleFinID = await getSimpleFinID(account);
    if (!simpleFinID) continue;

    const simpleFinAccount = await getSimpleFinAccounts({ account: simpleFinID }).then(accounts => accounts[0]);
    if (!simpleFinAccount) continue;

    const balanceDate = new Date(simpleFinAccount['balance-date'] * 1000);
    if (dateToNumber(balanceDate) < dateToNumber(new Date())) {
      continue;
    }

    console.log(`Syncing balance for ${syncType} account:`, account.name);

    await updateAccountBalance({
      account,
      newBalance: +simpleFinAccount.balance,
      payee: 'Balance Adjustment',
    })
  }
}
