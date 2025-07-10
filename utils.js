const api = require('@actual-app/api');
require("dotenv").config();

const fs = require('fs');
const readline = require('readline-sync');

const Utils = {
  openBudget: async function () {
    process.on('unhandledRejection', (reason, p) => {
      console.error('Unhandled Rejection at: Promise', p, 'reason:', reason);
      console.error(reason.stack);
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
  },

  closeBudget: async function () {
    console.log("done");
    try {
      await api.shutdown();
    } catch (e) {
      console.error(e);
      process.exit(1);
    }
  },

  getAccountBalance: async function (account, cutoffDate) {
    const filter = {
      'account': account.id,
    }
    if (cutoffDate) {
      filter.date = { $lt: cutoffDate }
    }
    const data = await api.runQuery(
      api.q('transactions')
      .filter(filter)
      .calculate({ $sum: '$amount' })
      .options({ splits: 'grouped' })
    );
    return data.data;
  },

  getTransactions: async function (account) {
    const data = await api.runQuery(
      api.q('transactions')
        .select('*')
        .filter({
          'account': account.id,
        })
    );
    return data.data;
  },

  getLastTransaction: async function (account, cutoffDate=undefined, inbound=false, notes=undefined) {
    if (cutoffDate === undefined || cutoffDate === null) {
        cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() + 1);
    }
    const filters = {
      'account': account.id,
      'date': { $lt: cutoffDate },
      'notes': notes,
    };
    if (!inbound) {
      filters['amount'] = { $gt: 0 };
    }
    const data = await api.runQuery(
      api.q('transactions')
        .filter(filters)
        .select('*')
        .orderBy({ 'date': 'desc' })
        .limit(1)
        .options({ splits: 'grouped' })
    );
    if (!data.data.length) {
      return undefined;
    }
    return data.data[0];
  },

  ensurePayee: async function (payeeName) {
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
  },

  ensureCategoryGroup: async function (categoryGroupName) {
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
  },

  ensureCategory: async function (categoryName, groupId, is_income=false) {
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
  },

  getTagValue: function (note, tag, defaultValue=undefined) {
    if (!note) {
      return undefined;
    }
    tag += ':'
    const tagIndex = note.indexOf(tag);
    if (tagIndex === -1) {
      return defaultValue;
    }
    return note.split(tag)[1].split(/[\s]/)[0]
  },

  getNote: async function (id) {
    const notes = await api.runQuery(
      api.q('notes')
        .filter({ id })
        .select('*')
      );
    if (notes.data.length && notes.data[0].note) {
      return notes.data[0].note;
    }
    return undefined;
  },

  getAccountNote: async function (account) {
    return Utils.getNote(`account-${account.id}`);
  },

  setAccountNote: async function (account, note) {
    api.internal.send('notes-save', {
        id: `account-${account.id}`,
        note: note,
    });
  },

  updateAccountBalance: async function updateAccountBalance(account, newBalance) {
    const currentBalance = await Utils.getAccountBalance(account);
    const diff =  Math.round(newBalance * 100) - currentBalance;

    if (diff) {
      const lastTx = await Utils.getLastTransaction(account, undefined,true, { $like: 'Update balance to %' })
      const shouldUpdateTx = lastTx && new RegExp(`^${lastTx.date}T`).test(new Date().toISOString())

      const txNote = `Update balance to ${newBalance}`

      const payeeId = await Utils.ensurePayee(process.env.INVESTMENT_PAYEE_NAME || 'Investment');
      const categoryGroupId = await Utils.ensureCategoryGroup(process.env.INVESTMENT_CATEGORY_GROUP_NAME || 'Income');
      const categoryId = await Utils.ensureCategory(process.env.INVESTMENT_CATEGORY_NAME || 'Investment', categoryGroupId, true);

      if (shouldUpdateTx) {
        await api.updateTransaction(lastTx.id, {
          amount: +lastTx.amount + diff,
          notes: txNote,
        })
      } else {
        await api.importTransactions(account.id, [{
          date: new Date(),
          payee: payeeId,
          amount: diff,
          cleared: true,
          reconciled: true,
          category: categoryId,
          notes: txNote,
        }]);
      }
    }
  },

  getSimpleFinID: async function (account) {
    const data = await api.runQuery(
      api.q('accounts')
        .filter({ id: account.id })
        .filter({ account_sync_source: 'simpleFin' })
        .select('account_id')
      );
    if (data.data.length && data.data[0].account_id) {
      return data.data[0].account_id;
    }
    return undefined;
  },

  getSimpleFinAccounts: async () => {
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

    try {
      const url = `https://beta-bridge.simplefin.org/simplefin/accounts?start-date=${new Date().getTime()}&end-date=${new Date().getTime()}`;
      const response = await fetch(url, {
        headers: {
          'Authorization': `Basic ${btoa(`${username}:${pw}`)}`
        }
      });
      const data = await response.json();
      const accounts = data.accounts;
      const balances = {};
      accounts.forEach(a => balances[a.id] = parseFloat(a.balance));
      return accounts;
    } catch (e) {
      return undefined;
    }
  },

  sleep: function (ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  },  

  showPercent: function (pct) {
    return Number(pct).toLocaleString(undefined,
        { style: 'percent', maximumFractionDigits: 4 })
  },

  escapeRegExp: function (string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // $& means the whole matched string
  },
};

module.exports = Utils;
