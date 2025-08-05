import axios from 'axios'
import fs from 'fs'
import * as readline from 'readline-sync'

const cache = process.env.ACTUAL_CACHE_DIR || './cache'
const credentialFile = `${cache}/simplefin.credentials`

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
    }): Promise<SimpleFinAccount[]> => {
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
      } else {
        return response.data.accounts
      }
    },
  }
}

const getCredentials = async () => {
  if (process.env.SIMPLEFIN_CREDENTIALS) {
    return process.env.SIMPLEFIN_CREDENTIALS
  }

  const cached = loadCredentials()
  if (cached) {
    return cached
  }

  const token = readline.question('Enter your SimpleFIN setup token: ')
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
