// 최적화 해야함

require("dotenv").config();
const express = require("express");
const router = express.Router();
const db = require("../db");
const axios = require("axios");

const CLOUDFLARE_SECRET_KEY = process.env.CLOUDFLARE_SECRET_KEY;

// 플래너 생성 페이지 렌더링
router.get("/create/planner", (req, res) => {
  res.render("create-planner");
});

// 플래너 생성 처리
router.post("/planner/detail", async (req, res) => {
  let plannerName = req.body["plannerName"];
  let eventDate = req.body["eventDate"];
  const eventStart = req.body["startTime"];
  const userId = req.user.id;

  const turnstileToken = req.body["cf-turnstile-response"];

  try {
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
      return res.render("u-r-not-human");
    }

    if (!eventDate || eventDate.trim() === "") {
      const today = new Date();
      const year = today.getFullYear();
      const month = String(today.getMonth() + 1).padStart(2, "0");
      const day = String(today.getDate()).padStart(2, "0");

      eventDate = `${year}-${month}-${day}`;
    }

    if (!plannerName || plannerName.trim() === "") {
      plannerName = "새 플래너";
    }

    const insertPlannerQuery =
      "INSERT INTO route_snap.planners (planner_name, event_date, user_id, event_start) VALUES (?, ?, ?, ?)";
    db.query(
      insertPlannerQuery,
      [plannerName, eventDate, userId, eventStart],
      (err, insertPlannerResult) => {
        if (err) {
          console.error("데이터 삽입 오류: ", err);
          return res.status(500).send("서버 오류");
        }

        res.redirect("/dashboard");
      },
    );
  } catch (error) {
    console.error("Turnstile 검증 중 오류:", error);
    res.status(500).json({ message: "서버 오류가 발생했습니다." });
  }
});

// 특정 플래너의 상세 정보 조회
router.get("/planner/detail/:planner_id", (req, res) => {
  const plannerId = req.params.planner_id;
  const userId = req.user.id;
  const mapUrl = req.query.mapUrl;

  if (!plannerId) {
    return res.status(400).send("planner_id가 필요합니다.");
  }

  const getPlannerAndSchedulesQuery = `
    SELECT p.*, s.*
    FROM route_snap.planners p
    LEFT JOIN route_snap.schedules s ON p.planner_id = s.planner_id
    WHERE p.planner_id = ? AND p.user_id = ?
  `;

  db.query(
    getPlannerAndSchedulesQuery,
    [plannerId, userId],
    (err, plannerAndSchedules) => {
      if (err) {
        console.error("데이터베이스 조회 오류:", err);
        return res.status(500).send("서버 오류");
      }

      if (plannerAndSchedules.length === 0) {
        return res.status(404).send("플래너를 찾을 수 없습니다.");
      }

      plannerAndSchedules[0].planner_id = plannerId;

      let singlePlanner = plannerAndSchedules[0];

      // 스케줄 항목을 필터링하여 유효한 값만 포함되도록 수정
      const scheduleList = plannerAndSchedules
        .map((row) => {
          // 필터링: 만약 특정 값이 null이면 해당 항목을 null로 반환
          if (!row.departure_location || !row.arrival_location) {
            return null; // null 값이 있으면 해당 항목은 제외
          }

          let mode = "";
          switch (row.transportation_mode) {
            case "walk":
              mode = "🚶";
              break;
            case "car":
              mode = "🚗";
              break;
            case "transit":
              mode = "🚇/🚌";
              break;
            default:
              mode = row.transportation_mode; // 기본 값
          }

          return {
            schedule_id: row.schedule_id,
            departure_location: row.departure_location,
            transportation_mode: mode,
            travel_time: row.travel_time,
            arrival_location: row.arrival_location,
            stay_duration: row.stay_duration,
            quick_memo: row.quick_memo,
          };
        })
        // null 값 필터링: null 값 항목을 제외하고, 유효한 스케줄만 남기기
        .filter((schedule) => schedule !== null); // null 값 필터링

      const eventDateObject = new Date(singlePlanner.event_date);
      const year = eventDateObject.getFullYear();
      const month = String(eventDateObject.getMonth() + 1).padStart(2, "0");
      const day = String(eventDateObject.getDate()).padStart(2, "0");

      singlePlanner.event_date = `${year}년 ${month}월 ${day}일`;

      console.log(scheduleList);

      res.render("planner-detail", {
        planner: singlePlanner,
        schedules: scheduleList,
        mapUrl,
      });
    },
  );
});

// 특정 플래너 삭제
router.delete("/planner/detail/:planner_id", (req, res) => {
  const plannerId = req.params.planner_id;
  const userId = req.user.id;

  if (!plannerId) {
    return res.status(400).send("플래너 ID가 필요합니다.");
  }

  // 트랜잭션 시작
  db.beginTransaction((err) => {
    if (err) {
      console.error("트랜잭션 시작 오류: ", err);
      return res.status(500).send("서버 오류");
    }

    // 스케줄 삭제
    const deleteSchedulesQuery =
      "DELETE FROM route_snap.schedules WHERE planner_id = ? AND user_id = ?";
    db.query(
      deleteSchedulesQuery,
      [plannerId, userId],
      (err, deleteSchedulesResult) => {
        if (err) {
          return db.rollback(() => {
            console.error("스케줄 삭제 오류: ", err);
            res.status(500).send("스케줄 삭제 중 오류 발생");
          });
        }

        // 플래너 삭제
        const deletePlannerQuery =
          "DELETE FROM route_snap.planners WHERE planner_id = ? AND user_id = ?";
        db.query(
          deletePlannerQuery,
          [plannerId, userId],
          (err, deletePlannerResult) => {
            if (err) {
              return db.rollback(() => {
                console.error("플래너 삭제 오류 :", err);
                res.status(500).send("플래너 삭제 중 오류 발생");
              });
            }

            // 트랜잭션 커밋
            db.commit((err) => {
              if (err) {
                return db.rollback(() => {
                  console.error("커밋 오류 :", err);
                  res.status(500).send("서버 오류");
                });
              }
              res.status(200).send("플래너와 스케줄 삭제가 완료되었습니다.");
            });
          },
        );
      },
    );
  });
});

// 플래너 헤더 수정
router.post("/planner/header/edit", (req, res) => {
  const plannerId = req.body["planner-id"];
  const plannerName = req.body["planner-name"];
  const eventDate = req.body["event-date"];
  const userId = req.user.id;

  const updatePlannerQuery = `
    UPDATE route_snap.planners
    SET planner_name = ?, event_date = ?
    WHERE planner_id = ? AND user_id = ?;
  `;

  db.query(
    updatePlannerQuery,
    [plannerName, eventDate, plannerId, userId],
    (err, updatePlannerResult) => {
      if (err) {
        console.error("Error updating planner:", err);
        return;
      }
      console.log("Planner updated successfully:", updatePlannerResult);
    },
  );

  res.redirect(`/planner/detail/${plannerId}`);
});

module.exports = router;
