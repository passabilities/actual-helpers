import * as api from '@actual-app/api'
import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import schedule from 'node-schedule'
import trackKBB from './kbb'

import syncBalance from './sync-balance'
import trackCrypto from './track-crypto'
import calcPayments from './calc-next-payment'
import { closeBudget, openBudget } from './utils'

dayjs.extend(utc)

openBudget().then(async () => {
  new schedule.Job('trackCrypto', async () => {
    const accounts: AccountEntity[] = await api.getAccounts()
    await trackCrypto(accounts)
  })
    .schedule('*/30 * * * *')

  new schedule.Job('syncBalance', async () => {
    await api.runBankSync().catch(() => {})

    const accounts: AccountEntity[] = await api.getAccounts()
    await syncBalance(accounts)
    await calcPayments(accounts)
  })
    .schedule('0 */8 * * *')

  new schedule.Job('trackKBB', async () => {
    const accounts: AccountEntity[] = await api.getAccounts()
    await trackKBB(accounts)
  })
    .schedule('0 12 * * *')

  Object.values(schedule.scheduledJobs).forEach((job) => {
    job.invoke()
  })
})

async function exitHandler(options: { cleanup?: boolean; exit?: boolean }, exitCode?: number) {
  await schedule.gracefulShutdown()
  await closeBudget();

  if (options.cleanup) console.log('clean');
  if (exitCode || exitCode === 0) console.log(exitCode);
  if (options.exit) process.exit();
}

// do something when app is closing
process.on('exit', exitHandler.bind(null,{cleanup:true}));

// catches ctrl+c event
process.on('SIGINT', exitHandler.bind(null, {exit:true}));

// catches "kill pid" (for example: nodemon restart)
process.on('SIGUSR1', exitHandler.bind(null, {exit:true}));
process.on('SIGUSR2', exitHandler.bind(null, {exit:true}));

// catches uncaught exceptions
process.on('uncaughtException', exitHandler.bind(null, {exit:true}));
