const ONES = [
  '', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine',
  'Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen',
  'Seventeen', 'Eighteen', 'Nineteen',
];

const TENS = [
  '', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety',
];

function twoDigits(n) {
  if (n < 20) return ONES[n];
  const tens = Math.floor(n / 10);
  const ones = n % 10;
  return TENS[tens] + (ones ? ' ' + ONES[ones] : '');
}

function threeDigits(n) {
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  let out = '';
  if (hundreds) out += ONES[hundreds] + ' Hundred';
  if (rest) out += (out ? ' ' : '') + twoDigits(rest);
  return out;
}

/**
 * Converts a non-negative integer into words using the Indian numbering
 * system (Thousand / Lakh / Crore), e.g. 1234567 -> "Twelve Lakh Thirty
 * Four Thousand Five Hundred Sixty Seven".
 */
function integerToIndianWords(num) {
  if (num === 0) return 'Zero';

  const crore = Math.floor(num / 10000000);
  num %= 10000000;
  const lakh = Math.floor(num / 100000);
  num %= 100000;
  const thousand = Math.floor(num / 1000);
  num %= 1000;
  const hundred = num;

  const parts = [];
  if (crore) parts.push(threeDigits(crore) + ' Crore');
  if (lakh) parts.push(twoDigits(lakh) + ' Lakh');
  if (thousand) parts.push(twoDigits(thousand) + ' Thousand');
  if (hundred) parts.push(threeDigits(hundred));

  return parts.join(' ').replace(/\s+/g, ' ').trim();
}

/**
 * Converts a rupee amount (number, can include paise as decimals) into a
 * currency-in-words string, e.g. 2599.5 -> "Two Thousand Five Hundred
 * Ninety Nine Rupees And Fifty Paise Only".
 */
function amountToIndianWords(amount) {
  const value = Math.abs(Number(amount) || 0);
  const rupees = Math.floor(value);
  const paise = Math.round((value - rupees) * 100);

  let words = integerToIndianWords(rupees) + ' Rupee' + (rupees === 1 ? '' : 's');
  if (paise > 0) {
    words += ' And ' + integerToIndianWords(paise) + ' Paise';
  }
  words += ' Only';
  return words;
}

module.exports = { integerToIndianWords, amountToIndianWords };