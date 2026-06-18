const PDFDocument = require("pdfkit");
const moment = require("moment");
const path = require("path");
const logoPath = path.join(__dirname, "../public/images/logo.png");

const generateInvoice = (order, res) => {
  const doc = new PDFDocument({ margin: 50, size: "A4" });

  // Pipe to response
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=invoice-${order.orderNumber}.pdf`,
  );
  doc.pipe(res);

  // Color scheme
  const primaryColor = "#1a1a2e";
  const accentColor = "#f0a500";

  // Header background
  doc.rect(0, 0, 595, 120).fill(primaryColor);

  // Logo / Company name
  doc.image(logoPath, 50, 25, {
    width: 45,
    height: 45,
  });
  doc
    .fontSize(28)
    .font("Helvetica-Bold")
    .fillColor("#ef4444")
    .text("AD21Store", 105, 35);
  doc
    .fontSize(10)
    .font("Helvetica")
    .fillColor("#cccccc")
    .text("Premium Sports Merchandise", 105, 68);
  doc
    .fontSize(10)
    .fillColor("#aaaaaa")
    .text("www.ad21store.com | support@ad21store.com", 105, 82);

  // Invoice header
  doc
    .fontSize(22)
    .font("Helvetica-Bold")
    .fillColor(primaryColor)
    .text("INVOICE", 400, 140, { align: "right" });
  doc.fontSize(10).font("Helvetica").fillColor("#666666");
  doc.text(`Invoice #: ${order.orderNumber}`, 400, 168, { align: "right" });
  doc.text(`Date: ${moment(order.createdAt).format("DD MMM YYYY")}`, 400, 182, {
    align: "right",
  });
  doc.text(`Status: ${order.orderStatus}`, 400, 196, { align: "right" });

  // Customer info
  doc
    .fontSize(11)
    .font("Helvetica-Bold")
    .fillColor(primaryColor)
    .text("Bill To:", 50, 140);
  doc.fontSize(10).font("Helvetica").fillColor("#444444");
  doc.text(
    order.shippingAddress?.fullName || order.user?.name || "Customer",
    50,
    156,
  );
  if (order.shippingAddress) {
    doc.text(order.shippingAddress.addressLine1, 50, 170);
    if (order.shippingAddress.addressLine2)
      doc.text(order.shippingAddress.addressLine2, 50, 184);
    doc.text(
      `${order.shippingAddress.city}, ${order.shippingAddress.state} - ${order.shippingAddress.pincode}`,
      50,
      198,
    );
    doc.text(order.shippingAddress.country || "India", 50, 212);
    doc.text(`Phone: ${order.shippingAddress.phone}`, 50, 226);
  }

  // Divider
  doc.moveTo(50, 250).lineTo(545, 250).stroke(accentColor);

  // Table header
  const tableTop = 265;
  doc.rect(50, tableTop, 495, 24).fill("#f8f8f8");
  doc.fontSize(10).font("Helvetica-Bold").fillColor(primaryColor);
  doc.text("Product", 60, tableTop + 7);
  doc.text("Qty", 310, tableTop + 7, { width: 50, align: "center" });
  doc.text("Unit Price", 360, tableTop + 7, { width: 90, align: "right" });
  doc.text("Total", 450, tableTop + 7, { width: 85, align: "right" });

  // Table rows
  let y = tableTop + 34;
  doc.font("Helvetica").fillColor("#444444").fontSize(10);

  order.items.forEach((item, i) => {
    if (i % 2 === 0) doc.rect(50, y - 5, 495, 22).fill("#fafafa");
    doc.fillColor("#444444");
    const productName = item.product?.name || item.productName || "Product";
    const variant = item.variant
      ? ` (${item.variant.size || ""} ${item.variant.color || ""})`.trim()
      : "";
    doc.text(`${productName}${variant}`, 60, y, { width: 240 });
    doc.text(item.quantity.toString(), 310, y, { width: 50, align: "center" });
    doc.text(`₹${item.price.toFixed(2)}`, 360, y, {
      width: 90,
      align: "right",
    });
    doc.text(`₹${(item.price * item.quantity).toFixed(2)}`, 450, y, {
      width: 85,
      align: "right",
    });
    y += 24;
  });

  // Divider
  doc
    .moveTo(50, y + 5)
    .lineTo(545, y + 5)
    .stroke("#eeeeee");
  y += 20;

  // Totals
  const totalsX = 350;
  doc.font("Helvetica").fillColor("#666666").fontSize(10);
  doc.text("Subtotal:", totalsX, y);
  doc.text(`₹${(order.subtotal || order.totalAmount).toFixed(2)}`, 450, y, {
    width: 85,
    align: "right",
  });
  y += 18;

  if (order.discountAmount > 0) {
    doc.fillColor("#16a34a").text("Discount:", totalsX, y);
    doc.text(`-₹${order.discountAmount.toFixed(2)}`, 450, y, {
      width: 85,
      align: "right",
    });
    y += 18;
  }
  if (order.couponDiscount > 0) {
    doc.fillColor("#16a34a").text("Coupon:", totalsX, y);
    doc.text(`-₹${order.couponDiscount.toFixed(2)}`, 450, y, {
      width: 85,
      align: "right",
    });
    y += 18;
  }

  doc.fillColor("#666666").text("Shipping:", totalsX, y);
  doc.text(
    order.shippingCharge === 0
      ? "FREE"
      : `₹${(order.shippingCharge || 0).toFixed(2)}`,
    450,
    y,
    { width: 85, align: "right" },
  );
  y += 18;

  // Grand total
  doc.rect(350, y, 195, 28).fill(primaryColor);
  doc.fontSize(12).font("Helvetica-Bold").fillColor("#ffffff");
  doc.text("Total:", 360, y + 8);
  doc.text(`₹${order.totalAmount.toFixed(2)}`, 450, y + 8, {
    width: 85,
    align: "right",
  });
  y += 44;

  // Payment info
  doc.fontSize(10).font("Helvetica").fillColor("#666666");
  doc.text(`Payment Method: ${order.paymentMethod || "N/A"}`, 50, y);
  doc.text(`Payment Status: ${order.paymentStatus || "N/A"}`, 50, y + 15);

  // Footer
  doc.moveTo(50, 740).lineTo(545, 740).stroke("#eeeeee");
  doc
    .fontSize(9)
    .font("Helvetica")
    .fillColor("#999999")
    .text(
      "Thank you for shopping with AD21Store! For any queries, contact support@ad21store.com",
      50,
      750,
      { align: "center", width: 495 },
    );

  doc.end();
};

module.exports = { generateInvoice };
