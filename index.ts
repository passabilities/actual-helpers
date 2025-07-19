import * as api from '@actual-app/api'
import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc'
import schedule from 'node-schedule'
import trackKBB from './kbb'

import syncBalance from './sync-balance'
import trackCrypto from './track-crypto'
import { closeBudget, openBudget } from './utils'

dayjs.extend(utc)

class MyJob extends schedule.Job {
  private _concurrency = 0

  get concurrency(): number {
    return this._concurrency
  }
  setConcurrency(value: number): MyJob {
    this._concurrency = value
    return this
  }

  invoke() {
    if (this._concurrency > 0 && this.triggeredJobs() >= this._concurrency) return

    // @ts-ignore
    return super.invoke(...arguments)
  }
}

openBudget().then(async () => {
  new MyJob('trackCrypto', async () => {
    const accounts: AccountEntity[] = await api.getAccounts()
    await trackCrypto(accounts)
  })
    .setConcurrency(1)
    .schedule('*/30 * * * *')

  new MyJob('syncBalance', async () => {
    const accounts: AccountEntity[] = await api.getAccounts()
    await syncBalance(accounts)
  })
    .schedule('0 12 * * *')

  new MyJob('trackKBB', async () => {
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
