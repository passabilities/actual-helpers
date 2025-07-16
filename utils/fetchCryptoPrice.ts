export async function fetchCryptoPrice(symbol: string): Promise<string> {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${symbol.toLowerCase()}usd`
  const response = await fetch(url);
  const json = await response.json();
  return json?.result?.[`X${symbol.toUpperCase()}ZUSD`]?.c[0];
}

export async function fetchCryptoValue(amount: number | string, symbol: string): Promise<string> {
  const price = await fetchCryptoPrice(symbol);
  return (+amount * +price).toFixed(2);
}
