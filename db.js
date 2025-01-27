require("dotenv").config();
const mysql = require("mysql2");

const db = mysql.createConnection({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD || "",
  database: process.env.DB_NAME,
});

db.connect((err) => {
  if (err) {
    console.error("MySQL 연결 오류:", err);
  } else {
    console.log("Database : MySQL (connected)");
  }
});

module.exports = db;

// require("dotenv").config();
// const mysql = require("mysql2/promise");

// const db = mysql.createPool({
//   host: process.env.DB_HOST,
//   user: process.env.DB_USER,
//   password: process.env.DB_PASSWORD || "",
//   database: process.env.DB_NAME,
// });

// module.exports = db;