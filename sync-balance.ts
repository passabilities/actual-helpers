import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'

import {
  getAccountNote,
  getSimpleFinID,
  getTagValue,
  updateAccountBalance,
} from './utils'
import * as simplefin from './utils/simplefin'

export default async function syncBalance(accounts: AccountEntity[]) {
  const simplefinApi = await simplefin.create()
  const simpleFinAccounts = await simplefinApi.getAccounts();

  for (const account of accounts) {
    if (account.closed) continue;

    const note = await getAccountNote(account);
    if (!note) continue;

    const syncType = getTagValue(note, 'sync');
    if (!syncType) continue;

    const simpleFinID = await getSimpleFinID(account);
    if (!simpleFinID) continue;

    const simpleFinAccount = simpleFinAccounts.find((acc) => acc.id === simpleFinID)
    if (!simpleFinAccount) continue;

    const balanceDate = dayjs.utc(simpleFinAccount['balance-date'] * 1000);

    console.log(`Syncing balance for ${syncType} account:`, account.name);

    await updateAccountBalance({
      account,
      newBalance: +simpleFinAccount.balance,
      payee: 'Balance Adjustment',
      date: balanceDate,
    })
  }
}
