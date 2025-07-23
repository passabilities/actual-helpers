import * as api from '@actual-app/api'
import { AccountEntity, TransactionEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import dayjs from 'dayjs'
import * as fs from 'fs'
import * as readline from 'readline-sync'

require("dotenv").config();

export async function openBudget() {
  process.on('unhandledRejection', (reason, p) => {
    console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
    if (reason instanceof Error) console.error(reason.stack);
    process.exit(1);
  });

  const url = process.env.ACTUAL_SERVER_URL || '';
  const password = process.env.ACTUAL_SERVER_PASSWORD || '';
  const file_password = process.env.ACTUAL_FILE_PASSWORD || '';
  const sync_id = process.env.ACTUAL_SYNC_ID || '';
  const cache = process.env.ACTUAL_CACHE_DIR || './cache';

  if (!url || !password || !sync_id) {
    console.error('Required settings for Actual not provided.');
    process.exit(1);
  }

  console.log("connect");
  await api.init({ serverURL: url, password: password, dataDir: cache });

  console.log("open file");
  if (file_password) {
    await api.downloadBudget(sync_id, { password: file_password, });
  } else {
    await api.downloadBudget(sync_id);
  }
}

export async function closeBudget() {
  console.log("done");
  try {
    await api.shutdown();
  } catch (e) {
    console.error(e);
    process.exit(1);
  }
}

export async function getAccountBalance(account: AccountEntity, cutoffDate?: Date): Promise<number> {
  const filter: Record<string, any> = {
    'account': account.id,
  }
  if (cutoffDate) {
    filter.date = { $lt: cutoffDate }
  }
  const data = await api.aqlQuery(
    api.q('transactions')
    .filter(filter)
    .calculate({ $sum: '$amount' })
    .options({ splits: 'grouped' })
  ) as { data: number };
  return data.data;
}

export async function getTransactions(account: AccountEntity): Promise<TransactionEntity[]> {
  const data = await api.aqlQuery(
    api.q('transactions')
      .select(['*'])
      .filter({
        'account': account.id,
      })
  ) as { data: TransactionEntity[] };
  return data.data;
}

export async function getLastTransaction(account: AccountEntity, cutoffDate?: dayjs.Dayjs, notes?: string | Record<string, any>): Promise<TransactionEntity | undefined> {
  if (!cutoffDate) {
      cutoffDate = dayjs.utc().add(1, 'day');
  }
  const filters: Record<string, any> = {
    'account': account.id,
    'date': { $lt: cutoffDate.format('YYYY-MM-DD') },
  };
  if (notes) filters.notes = notes;
  const data = await api.aqlQuery(
    api.q('transactions')
      .filter(filters)
      .select(['*'])
      .orderBy({ 'date': 'desc' })
      .limit(1)
      .options({ splits: 'grouped' })
  ) as { data: TransactionEntity[] };
  if (!data.data.length) {
    return undefined;
  }
  return data.data[0];
}

export async function ensurePayee(payeeName: string): Promise<string> {
  try {
    const payees = await api.getPayees();
    let payeeId = payees.find(p => p.name === payeeName)?.id;
    if (!payeeId) {
      payeeId = await api.createPayee({ name: payeeName });
    }
    if (payeeId) {
      return payeeId;
    }
  } catch (e) {
    console.error(e);
  }
  console.error('Failed to create payee:', payeeName);
  process.exit(1);
}

export async function ensureCategoryGroup(categoryGroupName: string): Promise<string> {
  try {
    const groups = await api.getCategoryGroups();
    let groupId = groups.find(g => g.name === categoryGroupName)?.id;
    if (!groupId) {
      groupId = await api.createCategoryGroup({ name: categoryGroupName });
    }
    if (groupId) {
      return groupId;
    }
  } catch (e) {
    console.error(e);
  }
  console.error('Failed to create category group:', categoryGroupName);
  process.exit(1);
}

export async function ensureCategory(categoryName: string, groupId: string, is_income = false): Promise<string> {
  try {
    const categories = await api.getCategories();
    let categoryId = categories.find(c => c.name === categoryName)?.id;
    if (!categoryId) {
      categoryId = await api.createCategory({
        name: categoryName,
        group_id: groupId,
        is_income: is_income,
        hidden: false,
      });
    }
    if (categoryId) {
      return categoryId;
    }
  } catch (e) {
    console.error(e);
  }
  console.error('Failed to create category:', categoryName);
  process.exit(1);
}

export function getTagValue(note = '', tag: string, defaultValue?: string): string | undefined {
  if (!note) return undefined;

  tag += ':'
  const tagIndex = note.indexOf(tag);
  if (tagIndex === -1) return defaultValue;

  return note.split(tag)[1].split(/[\s]/)[0]
}

export async function getNote(id: string): Promise<string | undefined> {
  const data = await api.aqlQuery(
    api.q('notes')
      .filter({ id })
      .select(['*'])
    ) as { data: { note: string }[] };
  return data.data[0]?.note;
}

export async function getAccountNote(account: AccountEntity): Promise<string | undefined> {
  return getNote(`account-${account.id}`);
}

export async function setAccountNote(account: AccountEntity, note: string): Promise<void> {
  api.internal.send('notes-save', {
      id: `account-${account.id}`,
      note: note,
  });
}

interface UpdateBalanceArgs {
  account: AccountEntity
  newBalance: number
  payee: string
  note?: string
  category?: {
    name: string
    group: string
    income: boolean
  }
  date?: dayjs.Dayjs
}
export async function updateAccountBalance(args: UpdateBalanceArgs): Promise<void> {
  const today = dayjs.utc().set('hour', 0).set('minute', 0).set('second', 0);
  if (args.date) {
    if (!args.date.isUTC()) {
      args.date = args.date.utc();
    }
    if (args.date.isAfter(today, 'day')) {
      throw new Error(`Date cannot be in the future: ${args.date.format('YYYY-MM-DD')}`);
    }
  } else {
    args.date = today;
  }

  const payeeId = await ensurePayee(args.payee);
  let categoryId: string | undefined;
  if (args.category) {
    const categoryGroupId = await ensureCategoryGroup(args.category.group);
    categoryId = await ensureCategory(args.category.name, categoryGroupId, args.category.income);
  }

  const currentBalance = await getAccountBalance(args.account);
  const diff =  Math.round(args.newBalance * 100) - currentBalance;

  if (diff) {
    const lastTx = await getLastTransaction(args.account, undefined, { $like: '%#helper-script%' })
    const shouldUpdateTx = lastTx && args.date.isSame(dayjs.utc(lastTx.date), 'day');

    const txNote = `${args.note ?? `Update balance to ${args.newBalance}`} #helper-script`;

    console.log(`Updating account balance for "${args.account.name}" from ${currentBalance / 100} to ${args.newBalance}`);

    if (shouldUpdateTx) {
      await api.updateTransaction(lastTx.id, {
        amount: +lastTx.amount + diff,
        notes: txNote,
      })
    } else {
      await api.importTransactions(args.account.id, [{
        account: args.account.id,
        date: args.date.format('YYYY-MM-DD'),
        payee: payeeId,
        amount: diff,
        cleared: true,
        category: categoryId,
        notes: txNote,
      }]);
    }
  }
}

export async function getSimpleFinID(account: AccountEntity): Promise<string | undefined> {
  const data = await api.aqlQuery(
    api.q('accounts')
      .filter({ id: account.id })
      .filter({ account_sync_source: 'simpleFin' })
      .select(['account_id'])
    ) as { data: { account_id: string }[] };
  return data.data[0]?.account_id;
}

export type SimpleFinAccount = {
  id: string
  name: string
  currency: string
  balance: string
  "available-balance": string
  "balance-date": number
  "transactions": Array<{
    id: string
    posted: number
    amount: string
    description: string
  }>,
  extra: Record<string, any>
}
interface GetSimpleFinAccountsArgs {
  account?: string
  transactions?: boolean
}
export async function getSimpleFinAccounts(args?: GetSimpleFinAccountsArgs): Promise<SimpleFinAccount[]> {
  const getCredentials = async () => {
    if (process.env.SIMPLEFIN_CREDENTIALS) {
      return process.env.SIMPLEFIN_CREDENTIALS;
    }

    const token = readline.question('Enter your SimpleFIN setup token: ');
    const url = atob(token.trim());

    const response = await fetch(url, { method: 'post' });
    const api_url = await response.text();

    const rest = api_url.split('//', 2)[1];
    const auth = rest.split('@', 1)[0];
    const username = auth.split(':')[0];
    const pw = auth.split(':')[1];

    const data = `${username}:${pw}`;
    const cache = process.env.ACTUAL_CACHE_DIR || './cache';
    fs.writeFileSync(cache + '/simplefin.credentials', data);
    console.log('SimpleFIN credentials:', data);
    return data;
  };

  const loadCredentials = () => {
    try {
      const cache = process.env.ACTUAL_CACHE_DIR || './cache';
      return fs.readFileSync(cache + '/simplefin.credentials', 'utf8');
    } catch (err) {
      return undefined;
    }
  };

  let credentials = loadCredentials();
  if (!credentials) {
    credentials = await getCredentials();
  }
  const username = credentials.split(':')[0];
  const pw = credentials.split(':')[1];

  const params = new URLSearchParams({
    'start-date': new Date().getTime().toString(),
    'end-date': new Date().getTime().toString(),
  })
  if (args?.account) {
    params.set('account', args.account);
  }
  if (!args?.transactions) {
    params.set('balances-only', '1');
  }
  const response = await fetch(`https://beta-bridge.simplefin.org/simplefin/accounts?${params}`, {
    headers: {
      'Authorization': `Basic ${btoa(`${username}:${pw}`)}`
    }
  });
  const data = await response.json() as { accounts: SimpleFinAccount[] };
  return data.accounts;
}

export function sleep(ms: number): Promise<never> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function showPercent(pct: string): string {
  return Number(pct).toLocaleString(undefined,
    { style: 'percent', maximumFractionDigits: 4 })
}

export function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
}
