import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import { chromium, Page } from 'playwright'  // Or 'firefox' or 'webkit'.
import { formatEther, formatGwei, fromHex } from 'viem'

import { escapeRegExp, getAccountNote, setAccountNote, updateAccountBalance } from './utils'
import { fetchCryptoValue } from './utils/fetchCryptoPrice'

export default async function trackCrypto(accounts: AccountEntity[]) {
  await wrapFunctions(accounts, [
    checkValidators,
    checkEth,
    checkDebank,
  ])
}

const startComment = `[comment]: <> (== START HELPER ==)`
const endComment = `[comment]: <> (== END HELPER ==)`

type Fn = (account: AccountEntity, note: string, newNote: string[]) => Promise<{ matched: boolean, regex: RegExp }>

async function wrapFunctions(accounts: AccountEntity[], fns: Fn[]) {
  for (const account of accounts) {
    if (account.closed || !account.name.startsWith('Crypto - ')) continue

    const note = await getAccountNote(account)
    if (!note) continue

    for (const fn of fns) {
      const newNote = []
      newNote.push('')
      newNote.push(startComment)
      newNote.push('')

      try {
        const { matched, regex } = await fn(account, note, newNote)
        if (matched) {
          newNote.push('')
          newNote.push(endComment)
          newNote.push('')

          const beforeNotes = note.match(new RegExp(`([\\s\\S]*)[\\s\\S](?=${escapeRegExp(startComment)})`))?.[1]
          const afterNotes = note.match(new RegExp(`(?<=${escapeRegExp(endComment)})\\n*([\\s\\S]*)`))?.[1]
          if (beforeNotes) {
            newNote.splice(0, 0, beforeNotes.replace(/\n*$/, ''))
          }
          if (afterNotes) {
            newNote.push(afterNotes.replace(/\n*$/, ''))
          }
          if (!beforeNotes && !afterNotes) {
            const negatedNote = note.replace(new RegExp(`(\\n*${escapeRegExp(startComment)}\\n*)?${regex.source}(\\n*${escapeRegExp(endComment)}\\n*)?`, regex.flags), '')
            newNote.splice(0, 0, negatedNote)
          }

          await setAccountNote(account, newNote.join('\n'))
          break
        }
      } catch (error) {
        if (error instanceof Error) {
          console.error(error.message)
        }
      }
    }
  }
}

async function checkValidators(account: AccountEntity, note: string, newNote: string[]) {
  const regex = /validator:(\d+):(1|0?\.\d+)/g
  const validatorsMatch = note.match(regex)
  if (validatorsMatch) {
    const validators: string[] = []
    const percents: number[] = []
    for (const validatorStr of validatorsMatch) {
      const [ _, index, percent ] = validatorStr.match(new RegExp(regex.source))!
      validators.push(index)
      percents.push(parseFloat(percent))
    }
    const balanceResponse = await fetch(`${process.env.CONSENSUS_HOST}/eth/v1/beacon/states/finalized/validator_balances?id=${validators.join(',')}`)
    const json = await balanceResponse.json() as { data: { index: string, balance: string }[] }

    const balances: bigint[] = []
    for (const index of validators) {
      const validator = json.data.find(v => v.index === index)!
      const balance = BigInt(validator.balance)
      balances.push(balance)
    }

    newNote.push(`[comment]: <> (Only edit the comments below!)`)
    for (const i in validators) {
      const index = validators[i]
      const percent = percents[i]
      newNote.push(`[comment]: <> (validator:${index}:${percent})`)
    }
    newNote.push('')
    newNote.push('| Validator | Balance |')
    newNote.push('|-|-:|')
    let total = 0n
    for (const i in validators) {
      const index = validators[i]
      const balance = balances[i] * BigInt(percents[i] * 1_000_000) / 1_000_000n
      total += balance
      newNote.push(`| ${index} | ${formatGwei(balance)} |`)
    }
    const totalFormatted = formatGwei(total)

    newNote.push('')
    newNote.push(`ETH Balance: ${totalFormatted}`)

    const value = await fetchCryptoValue(totalFormatted, 'ETH')
    await updateAccountBalance({
      account,
      newBalance: +value,
      payee: 'Balance Adjustment',
    })
  }

  return { matched: !!validatorsMatch, regex }
}

async function checkEth(account: AccountEntity, note: string, newNote: string[]) {
  const regex = /eth:(0x[a-fA-F0-9]{40})/
  const ethMatch = note.match(regex)
  if (ethMatch) {
    const addr = ethMatch[1]

    const balanceResponse = await fetch(process.env.EXECUTION_HOST!, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getBalance',
        params: [ addr, 'latest' ],
        id: 1,
      }),
    })
    const json = await balanceResponse.json()
    const balance = formatEther(fromHex(json.result, 'bigint'))

    newNote.push(`eth:${addr}`)
    newNote.push(`ETH Balance: ${balance}`)

    const value = await fetchCryptoValue(balance, 'ETH')
    await updateAccountBalance({
      account,
      newBalance: +value,
      payee: 'Balance Adjustment',
    })
  }

  return { matched: !!ethMatch, regex }
}

async function checkDebank(account: AccountEntity, note: string, newNote: string[]) {
  const regex = /debank:(0x[a-fA-F0-9]{40})/g

  const debankMatch = note.match(regex)
  if (debankMatch) {
    const browser = await chromium.launch()
    const page = await browser.newPage()

    let balance = 0
    for (const addrStr of debankMatch) {
      const [ _, addr ] = addrStr.match(new RegExp(regex.source))!

      newNote.push(`debank:${addr}`)

      balance += await fetchDebankBalance(page, addr)
    }

    await browser.close()

    await updateAccountBalance({
      account,
      newBalance: balance,
      payee: 'Balance Adjustment',
    })
  }

  return { matched: !!debankMatch, regex }
}

async function fetchDebankBalance(page: Page, addr: string) {
  await page.goto(`https://debank.com/profile/${addr}`)

  const refreshLocator = page.locator('.UpdateButton_refresh__vkj2W', { hasText: 'Data updated' })
  const refreshBalance = async () => {
    const refreshButton = page.locator('.UpdateButton_refreshIcon__Zr6Rb')
    await refreshButton.click()

    const updatingLocator = page.locator('.UpdateButton_refresh__vkj2W', { hasText: 'Updating data' })
    await updatingLocator.waitFor()

    await refreshLocator.waitFor({ timeout: 60000 * 5 })

    // try {
    //   await refreshLocator.waitFor({ timeout: 120000 })
    //   const updatedMatch = await refreshLocator.innerText().then(t => t.match(/(\d+) (\w+)/));
    //   if (updatedMatch) {
    //     const [ _, duration, timeUnit ] = updatedMatch;
    //     switch (timeUnit) {
    //       case 'secs':
    //         return
    //       case 'mins':
    //         if (parseInt(duration) <= 5) return
    //       default:
    //         return await refreshBalance()
    //     }
    //   }
    // } catch (error) {
    //   await refreshBalance();
    // }
  }
  await refreshBalance()

  const assetTotalRegex = /\$(?!0+)([0-9,]+)/
  const assetTotalLocator = page.locator('.HeaderInfo_totalAssetInner__HyrdC', { hasText: assetTotalRegex })
  await assetTotalLocator.waitFor()
  const elementText = await assetTotalLocator.innerText()

  const [ _, balanceStr ] = elementText.match(assetTotalRegex)!
  const debankBalance = parseFloat(balanceStr.replace(/,/g, ''))
  const updatedText = await refreshLocator.innerText().then(t => t.replace(/\n/g, ' '))
  console.log(`Debank balance for ${addr}: $${balanceStr} - ${updatedText}`)

  return debankBalance
}
