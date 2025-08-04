import { AccountEntity } from '@actual-app/api/@types/loot-core/src/types/models'
import jsdom from 'jsdom'
import dayjs from 'dayjs'

import {
  getAccountNote,
  getLastTransaction,
  getTagValue,
  setAccountNote,
  sleep,
  updateAccountBalance,
} from './utils'

async function getKBB(url: URL) {
  url.searchParams.set('format', 'html')
  url.searchParams.set('requesteddataversiondate', new Date().toLocaleDateString())
  const response = await fetch(url, {
    cache: 'reload',
    mode: 'no-cors',
    headers: {
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.3',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
      'Accept-Language': 'en-US,en;q=0.7',
      'Referer': 'https://www.google.com/',
    },
  })

  const html = await response.text()
  const dom = new jsdom.JSDOM(html)

  const advisor = dom.window.document.getElementById('PriceAdvisor')
  const kbbText = advisor?.getElementsByTagName('text')[3].textContent
  if (kbbText) {
    return parseInt(kbbText.replace(/[$,]/g, ''))
  }

  const regex = /"value":\s*(\d+)/
  const match = html.match(regex)
  if (!match) throw new Error('Failed to parse KBB page')
  return parseInt(match[1])
}

export default async function trackKBB(accounts: AccountEntity[]) {
  for (const account of accounts) {
    let note = await getAccountNote(account)
    if (!note) continue

    let url: URL

    let mileage = getTagValue(note, 'kbbMileage')

    const kbbType = getTagValue(note, 'kbbType')
    if (!kbbType) continue
    switch (kbbType) {
      case 'car': {
        url = new URL('https://upa.syndication.kbb.com/usedcar/privateparty/sell')
        const vehicleid = getTagValue(note, 'kbbVehicleid')
        if (!vehicleid) continue
        url.searchParams.set('vehicleid', vehicleid)

        if (!process.env.KBB_API_KEY) throw new Error('Missing KBB API key')
        url.searchParams.set('apikey', process.env.KBB_API_KEY)

        const zip = getTagValue(note, 'kbbZipcode', '46237')
        if (zip) url.searchParams.set('zipcode', zip)

        const condition = getTagValue(note, 'kbbCondition', 'good')
        if (condition) url.searchParams.set('condition', condition)

        const dailyMileage = getTagValue(note, 'kbbDailyMileage')
        if (mileage) {
          if (dailyMileage) {
            const daily = parseInt(dailyMileage)
            let mileageUpdated = getTagValue(note, 'kbbMileageUpdated')
            if (!mileageUpdated) {
              const lastTx = await getLastTransaction(account, undefined)
              if (lastTx) {
                mileageUpdated = lastTx.date
                note += `\nkbbMileageUpdated:${mileageUpdated}`
              }
            }
            // dayjs.utc().format('YYYY-MM-DD')
            if (mileageUpdated) {
              const today = dayjs.utc().set('hour', 0).set('minute', 0).set('second', 0)
              const days = today.diff(dayjs.utc(mileageUpdated), 'days')
              if (days > 0) {
                mileage = String(parseInt(mileage) + (days * daily))

                const newNote = note
                  .replace(/kbbMileage:\d+/, `kbbMileage:${mileage}`)
                  .replace(/kbbMileageUpdated:\d\d\d\d-\d\d-\d\d/, `kbbMileageUpdated:${today.format('YYYY-MM-DD')}`)
                await setAccountNote(account, newNote)
              }
            }
          }
          url.searchParams.set('mileage', mileage)
        }

        const options = getTagValue(note, 'kbbOptions')
        if (options) url.searchParams.set('optionids', options)

        break
      }
      case 'motorcycle': {
        const make = getTagValue(note, 'kbbMake')
        const model = getTagValue(note, 'kbbModel')
        const year = getTagValue(note, 'kbbYear')
        if (!make || !model || !year) throw new Error('Missing make, model, or year')

        url = new URL(`https://www.kbb.com/motorcycles/${make}/${model}/${year}/`)

        break
      }
      default: {
        throw new Error('Unknown KBB type: ' + kbbType)
      }
    }

    const pricetype = getTagValue(note, 'kbbPriceType')
    if (pricetype) url.searchParams.set('pricetype', pricetype)

    try {
      console.log('Fetching KBB for account:', account.name)
      const kbb = await getKBB(url)

      await updateAccountBalance({
        account,
        newBalance: kbb,
        payee: 'KBB',
        note: `Update KBB to ${kbb}${mileage ? ` (${mileage} miles)` : ''}`,
      })
    } catch (error) {
      if (error instanceof Error) {
        console.error(error.message)
      }
    }

    await sleep(1324)
  }
}
