import axios from 'axios'
import fs from 'fs'
import path from 'path'
import dayjs from 'dayjs'
import * as readline from 'readline-sync'

const cache = process.env.ACTUAL_CACHE_DIR || './cache'
const credentialFile = `${cache}/simplefin.credentials`
const accountsCacheFile = path.join(cache, 'simplefin-accounts.json')

export interface SimpleFinOrganization {
  domain: string
  'sfin-url': string
}

interface AccountSet {
  errors: string[]
  accounts: SimpleFinAccount[]
}

export interface SimpleFinAccount {
  org: SimpleFinOrganization
  id: string
  name: string
  currency: string
  balance: string
  'available-balance': string
  'balance-date': number
  transactions: SimpleFinTransaction[]
  holdings: any[]
  extra?: Record<string, any>
}

export interface SimpleFinTransaction {
  id: string
  posted: number
  amount: string
  description: string
}

interface CachedAccountsData {
  timestamp: string
  accounts: SimpleFinAccount[]
}

const CACHE_DURATION_HOURS = 12

function getCachedAccounts(): SimpleFinAccount[] | null {
  try {
    if (!fs.existsSync(accountsCacheFile)) {
      return null
    }

    const data = fs.readFileSync(accountsCacheFile, 'utf8')
    const cached: CachedAccountsData = JSON.parse(data)

    const cacheTime = dayjs(cached.timestamp)
    const now = dayjs()
    
    if (now.diff(cacheTime, 'hours') > CACHE_DURATION_HOURS) {
      console.log('SimpleFin cache expired')
      return null
    }

    console.log('Using cached SimpleFin accounts data')
    return cached.accounts
  } catch (error) {
    console.error('Error reading SimpleFin cache:', error)
    return null
  }
}

function setCachedAccounts(accounts: SimpleFinAccount[]): void {
  try {
    const data: CachedAccountsData = {
      timestamp: dayjs().toISOString(),
      accounts
    }
    
    fs.writeFileSync(accountsCacheFile, JSON.stringify(data, null, 2))
    console.log(`Cached ${accounts.length} SimpleFin accounts`)
  } catch (error) {
    console.error('Error writing SimpleFin cache:', error)
  }
}

export const create = async () => {
  const credentials = await getCredentials()
  const [username, pw] = credentials.split(':')

  const api = axios.create({
    baseURL: 'https://beta-bridge.simplefin.org/simplefin',
    headers: {
      'Authorization': `Basic ${btoa(`${username}:${pw}`)}`,
    },
  })

  return {
    getAccounts: async (args?: {
      account?: string
      transactions?: boolean
      useCache?: boolean
    }): Promise<SimpleFinAccount[]> => {
      // Default to using cache for balance-only requests
      const shouldUseCache = args?.useCache !== false && !args?.transactions
      
      // Try to get cached data if appropriate
      if (shouldUseCache && !args?.account) {
        const cached = getCachedAccounts()
        if (cached) {
          return cached
        }
      }

      // Fetch fresh data from API
      console.log('Fetching fresh SimpleFin accounts data')
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

      const response = await api.get<AccountSet>('/accounts', { params })
      if (response.data.errors.length) {
        throw new Error(response.data.errors.join('\n'))
      }
      
      const accounts = response.data.accounts
      
      // Cache the results if it was a full account fetch without transactions
      if (shouldUseCache && !args?.account) {
        setCachedAccounts(accounts)
      }
      
      return accounts
    },
  }
}

const getCredentials = async () => {
  const cached = loadCredentials()
  if (cached) {
    return cached
  }

  const token = process.env.SIMPLEFIN_TOKEN ?? readline.question('Enter your SimpleFIN setup token: ')
  const url = atob(token.trim())

  const response = await fetch(url, { method: 'post' })
  const api_url = await response.text()

  const rest = api_url.split('//', 2)[1]
  const auth = rest.split('@', 1)[0]
  const username = auth.split(':')[0]
  const pw = auth.split(':')[1]

  const data = `${username}:${pw}`
  fs.writeFileSync(credentialFile, data)
  console.log('SimpleFIN credentials:', data)
  return data
}

const loadCredentials = () => {
  try {
    return fs.readFileSync(credentialFile, 'utf8')
  } catch (err) {
    return undefined
  }
}
