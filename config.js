export default {
  PORT: process.env.PORT || 8080,
  PRICE_CATALOG_URL: process.env.PRICE_CATALOG_URL || "https://bassam-customs-calculator.onrender.com/assets/prices_catalog.json",
  CALCULATOR_URL: process.env.CALCULATOR_URL || "https://bassam-customs-calculator.onrender.com/index.html",
  FX_YER_PER_USD: parseFloat(process.env.FX_YER_PER_USD || "910"),
};
