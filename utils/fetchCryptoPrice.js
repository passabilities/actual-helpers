function getValueAtPath(obj, path) {
  const keys = path.split('.').filter(Boolean);

  return keys.reduce((acc, key) => {
    const match = key.match(/^([^\[\]]+)(\[(\d+)\])?$/);

    if (match) {
      const property = match[1];
      const index = match[3];

      acc = acc[property];

      if (index !== undefined) {
        acc = acc[parseInt(index, 10)];
      }
    } else {
      acc = acc[key];
    }

    return acc;
  }, obj);
}

/**
 *
 * @param {string} symbol
 * @returns {Promise<string>}
 */
async function fetchCryptoPrice(symbol) {
  const url = `https://api.kraken.com/0/public/Ticker?pair=${symbol.toLowerCase()}usd`
  const path = `result.X${symbol.toUpperCase()}ZUSD.c[0]`
  try {
    const response = await fetch(url);
    const json = await response.json();
    return getValueAtPath(json, path);
  } catch (error) {
    return undefined;
  }
}

/**
 *
 * @param {string} amount
 * @param {string} symbol
 * @returns {Promise<string>}
 */
async function fetchCryptoValue(amount, symbol) {
  const price = await fetchCryptoPrice(symbol);
  return (amount * price).toFixed(2);
}

module.exports = {
  fetchCryptoPrice,
  fetchCryptoValue,
}
