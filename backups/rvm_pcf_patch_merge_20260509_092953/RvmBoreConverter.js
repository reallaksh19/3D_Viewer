/**
 * RvmBoreConverter.js
 * Wave 4 – converts raw bore strings/numbers to DN (mm).
 * Pure JS: no DOM, no three.js.
 */

// NPS inch → DN (mm)
const NPS_TO_DN = {
  '1/8':   6,
  '1/4':   8,
  '3/8':  10,
  '1/2':  15,
  '3/4':  20,
  '1':    25,
  '1-1/4': 32,
  '1-1/2': 40,
  '2':    50,
  '2-1/2': 65,
  '3':    80,
  '4':   100,
  '5':   125,
  '6':   150,
  '8':   200,
  '10':  250,
  '12':  300,
  '14':  350,
  '16':  400,
  '18':  450,
  '20':  500,
  '24':  600,
  '28':  700,
  '30':  750,
  '32':  800,
  '36':  900,
  '40': 1000,
  '42': 1050,
  '48': 1200,
};

// OD (mm) → DN (mm)
const OD_TO_DN = [
  [10.3,   6],
  [13.7,   8],
  [17.1,  10],
  [21.3,  15],
  [26.7,  20],
  [33.4,  25],
  [42.2,  32],
  [48.3,  40],
  [60.3,  50],
  [73.0,  65],
  [88.9,  80],
  [114.3, 100],
  [141.3, 125],
  [168.3, 150],
  [219.1, 200],
  [273.0, 250],
  [323.8, 300],
  [355.6, 350],
  [406.4, 400],
  [457.0, 450],
  [508.0, 500],
  [609.6, 600],
  [711.0, 700],
  [762.0, 750],
];

const BORE_ATTR_KEYS = ['HBOR', 'TBOR', 'ABORE', 'LBORE', 'DTXR', 'BORE', 'NPS', 'DN', 'OD', 'Size'];

function normaliseFraction(str) {
  // e.g. "1-1/2" or "1/2" or "4"
  const whole = str.match(/^(\d+)-(\d+)\/(\d+)$/);
  if (whole) {
    const w = parseInt(whole[1], 10);
    const n = parseInt(whole[2], 10);
    const d = parseInt(whole[3], 10);
    return `${w}-${n}/${d}`;
  }
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) return `${frac[1]}/${frac[2]}`;
  const integer = str.match(/^(\d+(?:\.\d+)?)$/);
  if (integer) {
    const v = parseFloat(integer[1]);
    return Number.isInteger(v) ? String(Math.round(v)) : null;
  }
  return null;
}

export class RvmBoreConverter {
  /**
   * Find the raw bore value from a node's attributes.
   * @param {object} attrs
   * @returns {*} raw value or null
   */
  findRawBore(attrs) {
    const attrKeys = Object.keys(attrs);
    for (const key of BORE_ATTR_KEYS) {
      const upper = key.toUpperCase();
      const found = attrKeys.find(k => k.toUpperCase() === upper);
      if (found !== undefined && attrs[found] != null && attrs[found] !== '') {
        return attrs[found];
      }
    }
    return null;
  }

  /**
   * Convert a raw bore value to DN (mm).
   * @param {string|number|null} rawBore
   * @returns {{ bore: *, convertedBore: number|null, convertedBoreStatus: string, convertedBoreSource: string, boreMapping: string|null }}
   */
  convertBore(rawBore) {
    const result = {
      bore: rawBore,
      convertedBore: null,
      convertedBoreStatus: 'UNRESOLVED',
      convertedBoreSource: null,
      boreMapping: null,
    };

    if (rawBore == null) return result;

    // Try numeric path
    const num = typeof rawBore === 'number' ? rawBore : parseFloat(String(rawBore).replace(/[^\d.]/g, ''));

    // DN passthrough: integer (or x.0) in valid DN range
    if (typeof rawBore === 'number' || /^\d+(\.\d+)?$/.test(String(rawBore).trim())) {
      const n = typeof rawBore === 'number' ? rawBore : parseFloat(rawBore);
      if (Number.isFinite(n) && n >= 6 && n <= 1200 && (Number.isInteger(n) || n % 1 === 0)) {
        result.convertedBore = n;
        result.convertedBoreStatus = 'OK';
        result.convertedBoreSource = 'DN-PASSTHROUGH';
        result.boreMapping = `${rawBore}→${n}`;
        return result;
      }
    }

    const str = String(rawBore).trim();

    // DN(\d+) or NPS\s*(\d+) string
    const dnMatch = str.match(/^DN\s*(\d+(?:\.\d+)?)$/i);
    if (dnMatch) {
      const dn = parseFloat(dnMatch[1]);
      result.convertedBore = dn;
      result.convertedBoreStatus = 'OK';
      result.convertedBoreSource = 'DN-STRING';
      result.boreMapping = `${str}→${dn}`;
      return result;
    }

    const npsNumMatch = str.match(/^NPS\s*(\d+(?:\.\d+)?)$/i);
    if (npsNumMatch) {
      const npsVal = parseFloat(npsNumMatch[1]);
      const key = Number.isInteger(npsVal) ? String(Math.round(npsVal)) : null;
      if (key && key in NPS_TO_DN) {
        result.convertedBore = NPS_TO_DN[key];
        result.convertedBoreStatus = 'OK';
        result.convertedBoreSource = 'DN-STRING';
        result.boreMapping = `${str}→${NPS_TO_DN[key]}`;
        return result;
      }
    }

    // NPS inch fractions like `4"`, `1-1/2"`, `1/2"`
    const inchMatch = str.match(/^([\d\-\/]+)[""]?$/);
    if (inchMatch) {
      const raw = inchMatch[1];
      const key = normaliseFraction(raw);
      if (key && key in NPS_TO_DN) {
        const dn = NPS_TO_DN[key];
        result.convertedBore = dn;
        result.convertedBoreStatus = 'OK';
        result.convertedBoreSource = 'NPS-INCH';
        result.boreMapping = `${str}→${dn}`;
        return result;
      }
    }

    // OD lookup with ±1mm tolerance
    const odNum = parseFloat(str);
    if (Number.isFinite(odNum)) {
      for (const [od, dn] of OD_TO_DN) {
        if (Math.abs(odNum - od) <= 1.0) {
          result.convertedBore = dn;
          result.convertedBoreStatus = 'OK';
          result.convertedBoreSource = 'OD-MM';
          result.boreMapping = `${odNum}≈OD${od}→DN${dn}`;
          return result;
        }
      }
    }

    return result;
  }
}
