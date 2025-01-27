require("dotenv").config();
const express = require("express");
const app = express();
const axios = require("axios");
const bodyParser = require("body-parser");
const PORT = process.env.PORT || 3000;
const SECRET = process.env.SECRET;
const authRouter = require("./routes/authRouter");
const indexRouter = require("./routes/indexRouter");
const plannerRouter = require("./routes/plannerRouter");
const scheduleRouter = require("./routes/scheduleRouter");
const dashboardRouter = require("./routes/dashboardRouter");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const db = require("./db");
const session = require("express-session");
const bcrypt = require("bcrypt");
const flash = require("connect-flash");
app.set("view engine", "ejs");
app.use(express.static("public"));
app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(passport.initialize());
app.use(
  session({
    secret: SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);
app.use(passport.session());
app.use(flash());
app.use(bodyParser.json());
app.use("/", authRouter);
app.use("/", indexRouter);
app.use("/", ensureAuthenticated, plannerRouter);
app.use("/", ensureAuthenticated, scheduleRouter);
app.use("/", ensureAuthenticated, dashboardRouter);
app.use((req, res, next) => {
  res.locals.user = req.user || null; // 로그인된 사용자 정보를 EJS로 전달
  next();
});
app.use((req, res, next) => {
  res.locals.FlashErrorMessage = req.flash("error");
  next();
});

passport.use(
  new LocalStrategy(
    {
      usernameField: "username",
      passwordField: "password",
    },
    async (username, password, callback) => {
      try {
        // DB에서 사용자 찾기
        const [foundUser] = await new Promise((resolve, reject) => {
          db.query(
            "SELECT * FROM users WHERE username = ?",
            [username],
            (err, queryResults) => {
              if (err) reject(err);
              else resolve(queryResults);
            },
          );
        });

        if (!foundUser) {
          return callback(null, false, {
            message: "아이디가 존재하지 않습니다.",
          });
        }

        const isPasswordMatched = await bcrypt.compare(
          password,
          foundUser.password,
        );
        if (!isPasswordMatched) {
          return callback(null, false, {
            message: "비밀번호가 일치하지 않습니다.",
          });
        }

        return callback(null, foundUser); // 성공 시 사용자 정보 반환
      } catch (err) {
        return callback(err); // 에러 처리
      }
    },
  ),
);
passport.serializeUser((user, callback) => {
  callback(null, user.id); // 사용자의 ID를 세션에 저장
});
passport.deserializeUser((id, callback) => {
  db.query("SELECT * FROM users WHERE id = ?", [id], (err, queryResults) => {
    if (err) return callback(err);
    callback(null, queryResults[0]);
  });
});

function ensureAuthenticated(req, res, next) {
  if (req.isAuthenticated()) {
    return next();
  }
  res.redirect("/login");
}

app.listen(PORT, () => {
  console.log(`Server : http://localhost:${PORT} (connected)`);
});
