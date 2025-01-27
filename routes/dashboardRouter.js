const express = require("express");
const router = express.Router();
const db = require("../db");

// 날짜 포맷팅 함수 (YYYY년 MM월 DD일 형식)
const formatDate = (date) => {
  const dateObj = new Date(date);
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}년 ${month}월 ${day}일`;
};

// 플래너 목록 조회 함수
const getUserPlanners = (userId, callback) => {
  const query = `
    SELECT * 
    FROM route_snap.planners
    WHERE user_id = ?
  `;
  db.query(query, [userId], callback);
};

// 전체 플래너 목록 조회 및 대시보드 렌더링
router.get("/dashboard", (req, res) => {
  const userId = req.user.id;
  
  const sort = req.query.sort

  getUserPlanners(userId, (err, planners) => {
    if (err) {
      console.error("데이터베이스 오류:", err);
      return res.status(500).send("서버 오류");
    }

    if (req.query.sort === "name") {
      planners.sort((a, b) => {
        if (a.planner_name < b.planner_name) {
          return -1;
        }
        if (a.planner_name > b.planner_name) {
          return 1;
        }
        return 0;
      });
    } else if (req.query.sort === "date") {
      planners.sort((a, b) => {
        return new Date(a.event_date) - new Date(b.event_date);
      });
    }

    // 플래너의 날짜를 포맷팅
    planners.forEach((planner) => {
      planner.event_date = formatDate(planner.event_date);
    });

    res.render("dashboard", { plannerList: planners , sort});
  });
});

module.exports = router;
