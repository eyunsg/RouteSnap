// 최적화 해야함

const puppeteer = require("puppeteer");
const express = require("express");
const router = express.Router();
const db = require("../db");

// 플래너에 새로운 스케줄 추가
router.post("/planner/add-schedule", (req, res) => {
  const {
    planner_id,
    departure_location,
    transportation_mode,
    arrival_location,
    stay_duration_hours,
    stay_duration_minutes,
    quick_memo,
  } = req.body;

  const userId = req.user.id;

  const stay_duration =
    (parseInt(stay_duration_hours) || 0) * 60 +
    (parseInt(stay_duration_minutes) || 0);

  var travelDuration = "";

  getTravelTimeByMode(
    transportation_mode,
    departure_location,
    arrival_location,
  ).then((travelResult) => {
    travelDuration = travelResult.duration;
    mapUrl = travelResult.mapUrl;
    insertScheduleIntoDb(travelDuration, mapUrl);
  });

  function insertScheduleIntoDb(travel_time, mapUrl) {
    const query = `
      INSERT INTO route_snap.schedules
      (planner_id, departure_location, transportation_mode, travel_time, arrival_location, stay_duration, user_id, quick_memo)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;

    db.query(
      query,
      [
        planner_id,
        departure_location,
        transportation_mode,
        travel_time,
        arrival_location,
        stay_duration,
        userId,
        quick_memo,
      ],
      (err, result) => {
        if (err) {
          console.error("데이터 삽입 오류:", err);
          return res.status(500).send("서버 오류");
        }

        res.redirect(
          `/planner/detail/${planner_id}?mapUrl=${encodeURIComponent(mapUrl)}`,
        );
      },
    );
  }
});

// 특정 스케줄 삭제
router.delete("/planner/schedule/:schedule_id", (req, res) => {
  const scheduleId = req.params.schedule_id;
  const userId = req.user.id;

  if (!scheduleId) {
    return res.status(400).send("스케줄 ID가 필요합니다.");
  }

  const query = `
  DELETE FROM route_snap.schedules
  WHERE schedule_id = ? AND user_id = ?
  `;

  db.query(query, [scheduleId, userId], (err, result) => {
    if (err) {
      return db.rollback(() => {
        console.error("스케줄 삭제 오류:", err);
        res.status(500).send("서버 오류");
      });
    }
    res.status(200).send("스케줄 삭제 완료");
  });
});

// 특정 스케줄 수정
router.post("/planner/schedule/edit", (req, res) => {
  const plannerId = req.body["planner-id"];
  const schedule_id = req.body["schedule-id"];
  const {
    departure_location,
    transportation_mode,
    travel_time,
    arrival_location,
    stay_duration_hours,
    stay_duration_minutes,
  } = req.body;

  const userId = req.user.id;

  const stay_duration =
    (parseInt(stay_duration_hours) || 0) * 60 +
    (parseInt(stay_duration_minutes) || 0);

  const query = `
    UPDATE route_snap.schedules
    SET 
      departure_location = ?,
      transportation_mode = ?,
      travel_time = ?,
      arrival_location = ?,
      stay_duration = ?
    WHERE schedule_id = ? AND user_id = ?
    `;

  db.query(
    query,
    [
      departure_location,
      transportation_mode,
      travel_time,
      arrival_location,
      stay_duration,
      schedule_id,
      userId,
    ],
    (err, result) => {
      if (err) {
        console.error("업데이트 오류:", err);
        res.status(500).send("서버 오류");
        return;
      }
      res.redirect(`/planner/detail/${plannerId}`);
    },
  );
});

router.post("/schedule/refresh", (req, res) => {
  const { plannerId, scheduleId, departure, transportation, arrival } =
    req.body;

  console.log(plannerId);

  getTravelTimeByMode(transportation, departure, arrival).then(
    (travelResult) => {
      travelDuration = travelResult.duration;
      mapUrl = travelResult.mapUrl;
      updateScheduleIntoDb(travelDuration, scheduleId, mapUrl);
    },
  );

  function updateScheduleIntoDb(travel_time, scheduleId, mapUrl) {
    const query = `
      UPDATE route_snap.schedules
      SET travel_time = ?
      WHERE schedule_id = ?
    `;

    db.query(query, [travel_time, scheduleId], (err, result) => {
      if (err) {
        console.error("데이터 삽입 오류:", err);
        return res.status(500).send("서버 오류");
      }

      res.json(
        `/planner/detail/${plannerId}?mapUrl=${encodeURIComponent(mapUrl)}`,
      );
    });
  }
});

router.post("/api/refresh-all-travel-times", async (req, res) => {
  const schedules = req.body.schedules;

  // 스케줄 데이터를 순회하며 이동 소요 시간 계산 및 DB 업데이트
  const promises = schedules.map(async (schedule) => {
    const {
      schedule_id,
      departure_location,
      arrival_location,
      transportation_mode,
    } = schedule;

    let travelTime = 0; // 초기값 설정

    // 이동 수단에 따른 계산
    // switch (transportation_mode) {
    //   case "🚶":
    //     travelTime = (
    //       await getWalkTravelTimeBy(departure_location, arrival_location)
    //     ).duration;
    //     break;
    //   case "🚗":
    //     travelTime = (
    //       await getCarTravelTimeBy(departure_location, arrival_location)
    //     ).duration;
    //     break;
    //   case "🚇/🚌":
    //     travelTime = (
    //       await getTransitTravelTimeBy(departure_location, arrival_location)
    //     ).duration;
    //     break;
    //   default:
    //     travelTime = 0; // 기본값
    // }

    switch (transportation_mode) {
      case "🚶":
        travelTime = (
          await getTravelTimeByMode(
            "walk",
            departure_location,
            arrival_location,
          )
        ).duration;
        break;
      case "🚗":
        travelTime = (
          await getTravelTimeByMode("car", departure_location, arrival_location)
        ).duration;
        break;
      case "🚇/🚌":
        travelTime = (
          await getTravelTimeByMode(
            "transit",
            departure_location,
            arrival_location,
          )
        ).duration;
        break;
      default:
        travelTime = 0; // 기본값
    }

    // DB 업데이트 (비동기적으로 실행)
    return new Promise((resolve, reject) => {
      db.query(
        "UPDATE route_snap.schedules SET travel_time = ? WHERE schedule_id = ?",
        [travelTime, schedule_id],
        (err, results) => {
          if (err) reject(err);
          else resolve(results);
        },
      );
    });
  });

  // 모든 스케줄에 대한 처리를 비동기적으로 병렬 실행
  try {
    await Promise.all(promises);
    res.status(200).send("Travel times updated successfully");
  } catch (error) {
    console.error("Error updating travel times:", error);
    res.status(500).send("Error updating travel times");
  }
});

// 이동 시간 가져오는 함수 (중복 제거)
async function getTravelTimeByMode(mode, start, end) {
  switch (mode) {
    case "transit":
      return getTransitTravelTimeBy(start, end);
    case "car":
      return getCarTravelTimeBy(start, end);
    case "walk":
      return getWalkTravelTimeBy(start, end);
    default:
      return { duration: 0, mapUrl: "" };
  }
}

async function getCarTravelTimeBy(startLocation, endLocation) {
  console.log("자동차 이동 시간 계산 중...");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(
    "https://map.naver.com/p/directions/-/-/-/car?c=15.00,0,0,0,dh",
    { waitUntil: "networkidle2" },
  );

  await page.waitForSelector('input[id="input_search:r6:"]');
  await page.focus('input[id="input_search:r6:"]');
  await page.type('input[id="input_search:r6:"]', startLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r6:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.waitForSelector('input[id="input_search:r7:"]');
  await page.focus('input[id="input_search:r7:"]');
  await page.type('input[id="input_search:r7:"]', endLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r7:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  const goalButtonSelector = ".btn_departure.directions_box.goal";
  await page.waitForSelector(goalButtonSelector);
  await page.click(goalButtonSelector);

  const resultSelector =
    "ul.direction_summary_list > li.list_item:first-child .route_summary_info_duration strong span";
  await page.waitForSelector(resultSelector, { timeout: 10000 });

  const duration = await page.$$eval(resultSelector, (elements) => {
    let time = "";
    for (let i = 0; i < elements.length; i += 2) {
      const value = elements[i].textContent.trim();
      const unit = elements[i + 1]?.textContent.trim();
      time += `${value}${unit} `;
    }
    return time.trim();
  });

  const mapUrl = await page.url();

  console.log("계산 후 클라이언트로 전송 완료");

  await browser.close();

  return { duration, mapUrl };
}

async function getTransitTravelTimeBy(startLocation, endLocation) {
  console.log("대중교통 이동 시간 계산 중...");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(
    "https://map.naver.com/p/directions/-/-/-/transit?c=15.00,0,0,0,dh",
    { waitUntil: "networkidle2" },
  );

  await page.waitForSelector('input[id="input_search:r6:"]');
  await page.focus('input[id="input_search:r6:"]');
  await page.type('input[id="input_search:r6:"]', startLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r6:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.waitForSelector('input[id="input_search:r7:"]');
  await page.focus('input[id="input_search:r7:"]');
  await page.type('input[id="input_search:r7:"]', endLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r7:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  const goalButtonSelector = ".btn_departure.directions_box.goal";
  await page.waitForSelector(goalButtonSelector);
  await page.click(goalButtonSelector);

  const resultSelector = ".list_pubtrans_directions_summary .wrap_time_taken";

  await page.waitForSelector(resultSelector, { timeout: 10000 });

  const duration = await page.evaluate((selector) => {
    const timeWrap = document.querySelector(selector);
    if (!timeWrap) return "";

    const timeTakenElements = timeWrap.querySelectorAll(".time_taken");
    const timeUnitElements = timeWrap.querySelectorAll(".time_unit");

    if (timeTakenElements[1] && timeUnitElements[1]) {
      if (timeTakenElements.length >= 2 && timeUnitElements.length >= 2) {
        const time1 = timeTakenElements[0].textContent.trim();
        const unit1 = timeUnitElements[0].textContent.trim();
        const time2 = timeTakenElements[1].textContent.trim();
        const unit2 = timeUnitElements[1].textContent.trim();

        return `${time1}${unit1} ${time2}${unit2}`;
      }
    } else {
      if (timeTakenElements[0] && timeUnitElements[0]) {
        const time1 = timeTakenElements[0].textContent.trim();
        const unit1 = timeUnitElements[0].textContent.trim();

        return `${time1}${unit1}`;
      }
    }

    return "";
  }, resultSelector);

  const mapUrl = await page.url();

  console.log("계산 후 클라이언트로 전송 완료");

  await browser.close();

  return { duration, mapUrl };
}

async function getWalkTravelTimeBy(startLocation, endLocation) {
  console.log("도보 이동 시간 계산 중...");

  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  await page.goto(
    "https://map.naver.com/p/directions/-/-/-/walk?c=15.00,0,0,0,dh",
    { waitUntil: "networkidle2" },
  );

  await page.waitForSelector('input[id="input_search:r6:"]');
  await page.focus('input[id="input_search:r6:"]');
  await page.type('input[id="input_search:r6:"]', startLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r6:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.waitForSelector('input[id="input_search:r7:"]');
  await page.focus('input[id="input_search:r7:"]');
  await page.type('input[id="input_search:r7:"]', endLocation, {
    delay: 100,
  });

  await new Promise((resolve) => setTimeout(resolve, 500));

  await page.focus('input[id="input_search:r7:"]');
  await page.keyboard.press("Enter");

  await new Promise((resolve) => setTimeout(resolve, 500));

  const goalButtonSelector = ".btn_departure.directions_box.goal";
  await page.waitForSelector(goalButtonSelector);
  await page.click(goalButtonSelector);

  const resultSelector = ".item_btn .sc-iyowzb .direction_top_area";

  await page.waitForSelector(resultSelector, { timeout: 10000 });

  const duration = await page.evaluate((selector) => {
    const timeWrap = document.querySelector(selector);
    if (!timeWrap) return "";

    // item_value와 item_unit을 각각 추출
    const timeValueElements = timeWrap.querySelectorAll(".item_value");
    const timeUnitElements = timeWrap.querySelectorAll(".item_unit");

    // 시간이 2개 이상일 때
    if (timeValueElements.length >= 2 && timeUnitElements.length >= 2) {
      const time1 = timeValueElements[0].textContent.trim();
      const unit1 = timeUnitElements[0].textContent.trim();
      const time2 = timeValueElements[1].textContent.trim();
      const unit2 = timeUnitElements[1].textContent.trim();

      return `${time1}${unit1} ${time2}${unit2}`;
    }

    // 시간이 1개만 있을 때
    if (timeValueElements.length >= 1 && timeUnitElements.length >= 1) {
      const time1 = timeValueElements[0].textContent.trim();
      const unit1 = timeUnitElements[0].textContent.trim();

      return `${time1}${unit1}`;
    }

    return "";
  }, resultSelector);

  const mapUrl = await page.url();

  console.log("계산 후 클라이언트로 전송 완료");

  await browser.close();

  return { duration, mapUrl };
}

module.exports = router;
