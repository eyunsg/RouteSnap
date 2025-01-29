require("dotenv").config();
const express = require("express");
const bcrypt = require("bcrypt");
const router = express.Router();
const db = require("../db");
const passport = require("passport");
const LocalStrategy = require("passport-local").Strategy;
const GoogleStrategy = require("passport-google-oauth20").Strategy;
const nodemailer = require("nodemailer");
const { google } = require("googleapis");
const crypto = require("crypto");
const axios = require("axios");
const { render } = require("ejs");
const rateLimit = require("express-rate-limit");

const CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const CLIENT_SECRET = process.env.GOOGLE_SECRET;
const GOOGLE_APP_PASSWORD = process.env.GOOGLE_APP_PASSWORD;
const CLOUDFLARE_SECRET_KEY = process.env.CLOUDFLARE_SECRET_KEY;

// 로그인 시도에 대한 Rate Limiting 설정
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 5, // 15분 내 최대 5회 요청
  message:
    "로그인 요청 그만해라. 15분 뒤에 다시 해보도록. (일단 임시로 페이지에 띄움)",
});

// 이메일 인증 요청에 대한 Rate Limiting 설정
const emailLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15분
  max: 3, // 15분 내 최대 3회 요청
  message:
    "이메일 요청 그만해라. 15분 뒤에 다시 해보도록. (일단 임시로 페이지에 띄움)",
});

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: "iyunsung423@gmail.com",
    pass: GOOGLE_APP_PASSWORD,
  },
});

const sendEmail = (to, subject, text) => {
  const mailOptions = {
    from: "iyunsung423@gmail.com",
    to,
    subject,
    text,
  };

  return transporter.sendMail(mailOptions);
};

passport.use(
  new GoogleStrategy(
    {
      clientID: CLIENT_ID,
      clientSecret: CLIENT_SECRET,
      callbackURL: "http://localhost:8080/auth/google/callback",
    },
    (accessToken, refreshToken, profile, done) => {
      const { id, displayName, emails } = profile;

      db.query(
        "SELECT * FROM route_snap.users WHERE email = ?",
        [emails[0].value],
        (err, results) => {
          if (err) {
            console.error(err);
            return done(err);
          }

          if (results.length === 0) {
            const newUser = {
              google_id: id,
              username: displayName,
              email: emails[0].value,
              auth_provider: "google",
              isVerified: 1,
            };

            db.query(
              "INSERT INTO route_snap.users SET ?",
              newUser,
              (err, result) => {
                if (err) {
                  console.log(err);
                  return done(err);
                }
                newUser.id = result.insertId; // 새로 삽입된 사용자의 ID 추가
                return done(null, newUser); // 로그인 후 사용자 정보 반환
              },
            );
          } else {
            return done(null, results[0]);
          }
        },
      );
    },
  ),
);

passport.use(
  new LocalStrategy(
    { usernameField: "email", passwordField: "password" },
    async (email, password, done) => {
      try {
        const [user] = db.query("SELECT * FROM users WHERE email = ?", [email]);

        if (!user) {
          return done(null, false, { message: "Invalid credentials." });
        }

        const isPasswordValid = bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
          return done(null, false, { message: "Invalid credentials." });
        }

        if (!user.isVerified) {
          return done(null, false, {
            message: "Please verify your email before logging in.",
          });
        }

        return done(null, user); // 인증 성공
      } catch (error) {
        return done(error); // 서버 에러
      }
    },
  ),
);

// 세션에 사용자 정보를 저장
passport.serializeUser((user, done) => {
  done(null, user);
});

// 세션에서 사용자 정보 복원
passport.deserializeUser((user, done) => {
  done(null, user);
});

router.get("/register", (req, res) => {
  res.render("register");
});

router.post("/register", async (req, res) => {
  const { username, email, password } = req.body;
  const turnstileToken = req.body["cf-turnstile-response"];

  try {
    // Turnstile 토큰 유효성 검증
    const response = await axios.post(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      new URLSearchParams({
        secret: CLOUDFLARE_SECRET_KEY,
        response: turnstileToken,
      }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const result = response.data;

    if (!result.success) {
      // 유효하지 않은 토큰 처리
      return res.render("u-r-not-human");
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const auth_provider = "local";
    const verificationToken = crypto.randomBytes(32).toString("hex");

    const insertUserQuery =
      "INSERT INTO route_snap.users (username, email, password, auth_provider, verificationToken) VALUES (?, ?, ?, ?, ?)";

    db.query(
      insertUserQuery,
      [username, email, hashedPassword, auth_provider, verificationToken],
      async (error) => {
        if (error) {
          console.error("데이터 삽입 오류: ", error);
          return res.status(500).json({ message: "서버 오류가 발생했습니다." });
        }

        try {
          // 이메일 인증 링크 전송
          const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
              user: "iyunsung423@gmail.com",
              pass: GOOGLE_APP_PASSWORD,
            },
          });

          const verificationLink = `http://localhost:8080/verify?token=${verificationToken}`;

          transporter.sendMail({
            to: email,
            subject: "RouteSnap 본인 확인",
            html: `<p>Click <a href="${verificationLink}">here</a> to verify your email.</p>`,
          });

          // 성공 응답
          res.render("registerWelcome");
        } catch (emailError) {
          console.error("이메일 전송 중 오류: ", emailError);
          res
            .status(500)
            .json({ message: "이메일 전송 중 오류가 발생했습니다." });
        }
      },
    );
  } catch (error) {
    console.error("Turnstile 검증 중 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

router.get("/verify", async (req, res) => {
  const { token } = req.query;

  try {
    // 비동기 방식으로 쿼리 실행
    const [user] = await new Promise((resolve, reject) => {
      db.query(
        "SELECT * FROM route_snap.users WHERE verificationToken = ?",
        [token],
        (err, results) => {
          if (err) reject(err);
          resolve(results); // 결과를 resolve하여 받아옴
        },
      );
    });

    if (!user) {
      return res.status(400).send("Invalid or expired token.");
    }

    // 계정 활성화
    await new Promise((resolve, reject) => {
      db.query(
        "UPDATE users SET isVerified = TRUE, verificationToken = NULL WHERE id = ?",
        [user.id],
        (err) => {
          if (err) reject(err);
          resolve();
        },
      );
    });

    // 인증 완료 페이지 렌더링
    res.render("confirm-email-verification");
  } catch (err) {
    console.error(err);
    res.status(500).send("Internal server error.");
  }
});

router.get("/login", (req, res) => {
  const user = req.user;

  if (user) {
    return res.redirect("user-info");
  }

  // 로그인 페이지 렌더링 시 에러 메시지 전달
  const loginErrorMessage = req.flash("error"); // failureFlash에 저장된 메시지 가져옴
  res.render("login", { loginErrorMessage });
});

router.post("/login", loginLimiter, (req, res, next) => {
  passport.authenticate("local", (error, user, info) => {
    if (error) {
      return next(error); // 서버 에러 발생 시
    }
    if (!user) {
      req.flash("error", info.message); // 실패 메시지 전달
      return res.redirect("/login"); // 로그인 실패 시
    }

    // 사용자가 인증된 경우, isVerified 체크
    if (!user.isVerified) {
      req.flash("error", "이메일 인증을 완료해 주세요.");
      return res.redirect("/login"); // 이메일 인증이 안 됐다면 로그인 페이지로 리디렉션
    }

    req.logIn(user, (error) => {
      if (error) {
        return next(error); // 로그인 세션 저장 실패 시
      }
      return res.redirect("/"); // 로그인 성공 시
    });
  })(req, res, next);
});

router.get("/logout", (req, res, next) => {
  req.logout(function (error) {
    if (error) {
      return next(error); // 에러 처리
    }
    req.session.destroy(() => {
      res.clearCookie("connect.sid"); // 세션 쿠키 제거
      res.redirect("/"); // 로그아웃 후 리다이렉트
    });
  });
});

router.post("/validate-username", async (req, res) => {
  const { username } = req.body;

  // 아이디 유효성 검사
  if (!username || username.length < 4) {
    return res.status(400).json({ message: "아이디는 4자 이상이어야 합니다" });
  }
  if (username.length > 20) {
    return res.status(400).json({ message: "아이디는 20자 미만이어야 합니다" });
  }

  try {
    // SQL 쿼리로 아이디 중복 검사
    const checkUsernameExistsQuery =
      "SELECT COUNT(*) AS userCount FROM route_snap.users WHERE username = ?";

    db.query(checkUsernameExistsQuery, [username], (error, queryResults) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).json({ message: "서버 오류" });
      }
      // userCount가 0보다 크면 아이디가 중복됨
      if (queryResults[0].userCount > 0) {
        return res.json({ available: false });
      } else {
        return res.json({ available: true });
      }
    });
  } catch (error) {
    console.error("서버 오류:", error);
    return res.status(500).json({ message: "서버 오류" });
  }
});

router.post("/validate-email", emailLimiter, async (req, res) => {
  const { email } = req.body;

  // 이메일 유효성 검사
  const emailRegex = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;
  if (!email || !emailRegex.test(email)) {
    return res
      .status(400)
      .json({ message: "유효한 이메일 주소를 입력해주세요" });
  }

  try {
    // SQL 쿼리로 이메일 중복 검사
    const checkEmailExistsQuery =
      "SELECT COUNT(*) AS userCount FROM route_snap.users WHERE email = ?";

    db.query(checkEmailExistsQuery, [email], (error, queryResults) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).json({ message: "서버 오류" });
      }
      // userCount가 0보다 크면 이메일이 중복됨
      if (queryResults[0].userCount > 0) {
        return res.json({ available: false });
      } else {
        return res.json({ available: true });
      }
    });
  } catch (error) {
    console.error("서버 오류:", error);
    return res.status(500).json({ message: "서버 오류" });
  }
});

router.get("/checkLoggedInStatus", (req, res) => {
  if (req.isAuthenticated()) {
    // 로그인된 경우
    res.json({ loggedIn: true, username: req.user.username });
  } else {
    // 로그인되지 않은 경우
    res.json({ loggedIn: false });
  }
});

// 구글 로그인 시작
router.get(
  "/auth/google",
  passport.authenticate("google", {
    scope: ["profile", "email"], // 필요한 정보
  }),
);

// 구글 로그인 콜백
router.get(
  "/auth/google/callback",
  passport.authenticate("google", { failureRedirect: "/" }),
  (req, res) => {
    res.redirect("/"); // 로그인 후 리다이렉션
  },
);

router.post("/find-id", (req, res) => {
  const { email } = req.body;

  db.query(
    "SELECT username FROM route_snap.users WHERE email = ?",
    [email],
    (error, results) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).json({ message: "서버 오류" });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: "등록된 이메일이 없습니다" });
      }

      const username = results[0].username;
      return res.json({ message: username });
    },
  );
});

router.post("/reset-password-request", (req, res) => {
  const { email } = req.body;

  db.query(
    "SELECT id FROM route_snap.users WHERE email = ?",
    [email],
    (error, results) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).json({ message: "서버 오류" });
      }
      if (results.length === 0) {
        return res.status(404).json({ message: "등록된 이메일이 없습니다" });
      }

      // 재설정 토큰 생성
      const resetToken = crypto.randomBytes(32).toString("hex");
      const resetTokenExpires = Date.now() + 3600000; // 1시간 유효

      db.query(
        "UPDATE route_snap.users SET reset_token = ?, reset_token_expires = ? WHERE email = ?",
        [resetToken, resetTokenExpires, email],
        (error) => {
          if (error) {
            console.error("SQL 쿼리 오류:", error);
            return res.status(500).json({ message: "서버 오류" });
          }

          const resetLink = `http://localhost:8080/reset-password?token=${resetToken}`;
          sendEmail(
            email,
            "RouteSnap 비밀번호 재설정 링크",
            `다음부턴 안알려준다~\n\n아래 링크에 들어가서 재설정하세요!\n\n${resetLink}`,
          )
            .then(() =>
              res.json({ message: "비밀번호 재설정 이메일을 전송했습니다" }),
            )
            .catch((err) => {
              console.error("이메일 전송 오류:", err);
              res.status(500).json({ message: "이메일 전송 실패" });
            });
        },
      );
    },
  );
});

router.get("/reset-password", (req, res) => {
  const { token } = req.query;

  db.query(
    "SELECT id FROM route_snap.users WHERE reset_token = ? AND reset_token_expires > ?",
    [token, Date.now()],
    (error, results) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).send("서버 오류");
      }
      if (results.length === 0) {
        return res.status(400).send("유효하지 않거나 만료된 토큰입니다.");
      }

      // 유효한 토큰일 경우 비밀번호 재설정 폼 렌더링
      res.render("reset-password", { token }); // EJS 또는 다른 템플릿 엔진 사용
    },
  );
});

// 비밀번호 재설정 처리
router.post("/reset-password", async (req, res) => {
  const { token, newPassword } = req.body;
  const turnstileToken = req.body["cf-turnstile-response"];

  try {
    // Turnstile 토큰 유효성 검증
    const response = await axios.post(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      new URLSearchParams({
        secret: CLOUDFLARE_SECRET_KEY,
        response: turnstileToken,
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } },
    );

    const result = response.data;

    if (!result.success) {
      // Turnstile 검증 실패 시 처리
      return res.render("u-r-not-human");
    }
  } catch (error) {
    console.error("Turnstile 검증 중 오류:", error);
    return res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }

  // 비밀번호 해싱
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // SQL 쿼리
  db.query(
    "SELECT id FROM route_snap.users WHERE reset_token = ? AND reset_token_expires > ?",
    [token, Date.now()],
    (error, results) => {
      if (error) {
        console.error("SQL 쿼리 오류:", error);
        return res.status(500).json({ message: "서버 오류" });
      }
      if (results.length === 0) {
        return res
          .status(400)
          .json({ message: "유효하지 않거나 만료된 토큰입니다." });
      }

      const userId = results[0].id;

      // 비밀번호 업데이트 및 토큰 초기화
      db.query(
        "UPDATE route_snap.users SET password = ?, reset_token = NULL, reset_token_expires = NULL WHERE id = ?",
        [hashedPassword, userId],
        (error) => {
          if (error) {
            console.error("SQL 쿼리 오류:", error);
            return res.status(500).json({ message: "서버 오류" });
          }

          // 성공적인 비밀번호 변경
          res.render("reset-password-success");
        },
      );
    },
  );
});

router.get("/user-info", async (req, res) => {
  const user = req.user;

  console.log(req.user);

  if (!user) {
    return res.redirect("login");
  }

  res.render("user-info", { user });
});

module.exports = router;
