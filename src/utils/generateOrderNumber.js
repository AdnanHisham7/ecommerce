const generateOrderNumber = () => {
  const date = new Date();

  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");

  const random = Math.floor(100000 + Math.random() * 900000);

  return `FS-${y}${m}${d}-${random}`;
};

module.exports = generateOrderNumber;