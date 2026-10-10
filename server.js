// express 라이브러리 사용위함
const express = require('express')
require('express-async-errors')
const app = express()
const { MongoClient, ObjectId } = require('mongodb')
const { performance } = require('node:perf_hooks')
const { createRetryingDatabase, requestMetricsStorage } = require('./mongo-read-retry')
const methodOverride = require('method-override')
const bcrypt = require('bcryptjs')
const ytdl = require('ytdl-core');
const crypto = require('crypto');
require('dotenv').config()
const https = require('https')
const webpush = require('web-push')
const { waitUntil } = require('@vercel/functions');

const PUSH_PUBLIC_KEY = process.env.VAPID_PUBLIC_KEY;
const PUSH_PRIVATE_KEY = process.env.VAPID_PRIVATE_KEY;
const PUSH_SUBJECT = process.env.VAPID_SUBJECT || 'mailto:admin@goalpostagain.com';
const DEV_DISCORD_WEBHOOK = process.env.DEV_DISCORD_WEBHOOK;
const DEVELOPER_USER_ID = 'bigstarhan33';
const SEOUL_TIME_ZONE = 'Asia/Seoul';
const CRON_SECRET = process.env.CRON_SECRET;

function canViewMemberProfile(viewer, profileOwner) {
  return Boolean(viewer && profileOwner && (
    viewer.userID === profileOwner.userID || viewer.userID === DEVELOPER_USER_ID
  ));
}

const DEVELOPER_ALERT_COLORS = [
  { prefix: '[서비스 오류]', color: 0xD64545 },
  { prefix: '[클라이언트 오류]', color: 0xE67E22 },
  { prefix: '[웹푸시 구독 추가]', color: 0x168C83 },
  { prefix: '[웹푸시 발송 결과]', color: 0x2E8B57 },
  { prefix: '[푸시 서비스 접수 사용자]', color: 0x2980B9 },
  { prefix: '[전일 접속 사용자]', color: 0x168C83 }
];

if (PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY) {
  webpush.setVapidDetails(PUSH_SUBJECT, PUSH_PUBLIC_KEY, PUSH_PRIVATE_KEY);
}

function isPushConfigured() {
  return Boolean(PUSH_PUBLIC_KEY && PUSH_PRIVATE_KEY);
}

function getSeoulDateKey(date = new Date()) {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone: SEOUL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const dateParts = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${dateParts.year}-${dateParts.month}-${dateParts.day}`;
}

async function sendPushNotification(payload) {
  if (!isPushConfigured()) {
    return { sentUsernames: [], unidentifiedSentCount: 0, attemptedCount: 0, failedCount: 0, configured: false };
  }

  const [subscriptions, disabledUsers] = await Promise.all([
    db.collection('push_subscription').find({}).toArray(),
    db.collection('user').find({ pushNotificationsEnabled: false }, { projection: { username: 1 } }).toArray()
  ]);
  const disabledUsernames = new Set(disabledUsers.map((user) => user.username));
  const enabledSubscriptions = subscriptions.filter((record) => !disabledUsernames.has(record.username));
  const deliveryResults = await Promise.all(enabledSubscriptions.map(async (subscriptionRecord) => {
    try {
      await webpush.sendNotification(subscriptionRecord.subscription, JSON.stringify(payload));
      return { username: subscriptionRecord.username, sent: true };
    } catch (error) {
      if (error.statusCode === 404 || error.statusCode === 410) {
        await db.collection('push_subscription').deleteOne({ _id: subscriptionRecord._id });
      } else {
        console.error('Web push error:', error.message);
      }
      return { username: subscriptionRecord.username, sent: false };
    }
  }));

  return {
    sentUsernames: [...new Set(deliveryResults.filter((result) => result.sent && result.username).map((result) => result.username))],
    unidentifiedSentCount: deliveryResults.filter((result) => result.sent && !result.username).length,
    attemptedCount: enabledSubscriptions.length,
    failedCount: deliveryResults.filter((result) => !result.sent).length,
    configured: true
  };
}

async function sendDeveloperDiscordMessage(message) {
  if (!DEV_DISCORD_WEBHOOK) return;

  const url = new URL(DEV_DISCORD_WEBHOOK);
  const [titleLine, ...bodyLines] = String(message).split('\n');
  const title = (titleLine || '[개발자 알림]').slice(0, 256);
  const color = DEVELOPER_ALERT_COLORS.find(({ prefix }) => title.startsWith(prefix))?.color || 0x5865F2;
  const embed = {
    title,
    description: bodyLines.join('\n').slice(0, 4000) || '\u200b',
    color,
    timestamp: new Date().toISOString(),
    footer: { text: '오늘도골대 · DEV 알림' }
  };
  const postData = JSON.stringify({ embeds: [embed], allowed_mentions: { parse: [] } });

  return new Promise((resolve, reject) => {
    const request = https.request({
      hostname: url.hostname,
      path: `${url.pathname}${url.search}`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (response) => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve();
        reject(new Error(`Developer Discord webhook returned ${response.statusCode}`));
      });
    });
    request.on('error', reject);
    request.setTimeout(5000, () => request.destroy(new Error('Developer Discord webhook timed out')));
    request.write(postData);
    request.end();
  });
}

function scheduleBackgroundTask(task, taskName) {
  const guardedTask = Promise.resolve(task).catch((error) => {
    console.error(`${taskName} failed:`, error.message);
  });

  if (process.env.VERCEL) {
    try {
      waitUntil(guardedTask);
    } catch (error) {
      console.error(`${taskName} scheduling failed:`, error.message);
    }
  } else {
    void guardedTask;
  }
}

function chunkDiscordNames(title, usernames) {
  if (!usernames.length) return [`${title}\n없음`];

  const messages = [];
  let currentMessage = title;
  for (const username of usernames) {
    const line = `\n• ${username}`;
    if (currentMessage.length + line.length > 1700) {
      messages.push(currentMessage);
      currentMessage = `${title} (계속)`;
    }
    currentMessage += line;
  }
  messages.push(currentMessage);
  return messages;
}

function schedulePushNotification(payload) {
  scheduleBackgroundTask(
    sendPushNotification(payload).then(async (result) => {
      const summary = [
        '[웹푸시 발송 결과]',
        `알림: ${(payload.body || '새로운 소식이 있습니다.').slice(0, 300)}`,
        `푸시 서비스 접수 사용자 수: ${result.sentUsernames.length + result.unidentifiedSentCount}명`,
        `전송 요청: ${result.attemptedCount}건 · 실패: ${result.failedCount}건`,
        '※ 기기에서 실제 표시/확인한 여부가 아닌 푸시 서비스 접수 기준입니다.'
      ].join('\n');
      const recipientMessages = result.configured
        ? chunkDiscordNames('[푸시 서비스 접수 사용자]', result.sentUsernames)
        : ['[푸시 서비스 접수 사용자]\n발송 설정되지 않음'];
      if (result.unidentifiedSentCount) {
        recipientMessages[recipientMessages.length - 1] += `\n• 이름 미상 구독 ${result.unidentifiedSentCount}개`;
      }
      for (const message of [summary, ...recipientMessages]) {
        await sendDeveloperDiscordMessage(message);
      }
    }),
    'Web push notification'
  );
}

function reportDeveloperError(error, req) {
  if (!req || req._developerErrorReported) return;
  req._developerErrorReported = true;

  const username = req.user?.username || 'null';
  const method = req.method || 'UNKNOWN';
  const path = (req.originalUrl || req.url || '/').split('?')[0].slice(0, 160);
  const requestMetrics = req._requestMetrics;
  const retryInfo = error?.mongoReadRetry;
  const timingSummary = requestMetrics
    ? `\n요청 ID: ${requestMetrics.requestId}`
    : '';
  const retrySummary = retryInfo
    ? `\nMongoDB 읽기: ${retryInfo.operationName} (${retryInfo.attempts}/${retryInfo.maxAttempts}회 시도)`
      + `\nDB 작업 경과: ${(retryInfo.operationElapsedMs / 1000).toFixed(2)}초`
      + `\n재시도 대기: ${(retryInfo.backoffWaitMs / 1000).toFixed(2)}초`
    : '';
  const message = `${String(error?.message || error || 'Unknown error')}${timingSummary}${retrySummary}`.slice(0, 700);
  scheduleBackgroundTask(
    sendDeveloperDiscordMessage([
      '[서비스 오류]',
      `사용자: ${username}`,
      `요청: ${method} ${path}`,
      `오류: ${message}`
    ].join('\n')),
    'Developer error notification'
  );
}

const clientErrorReportTimes = new Map();

function reportClientError(req) {
  const now = Date.now();
  const requester = req.ip || req.socket.remoteAddress || 'unknown';
  const lastReportAt = clientErrorReportTimes.get(requester);
  if (lastReportAt && now - lastReportAt < 60_000) return;
  clientErrorReportTimes.set(requester, now);

  if (clientErrorReportTimes.size > 500) {
    for (const [ip, reportAt] of clientErrorReportTimes) {
      if (now - reportAt >= 60_000) clientErrorReportTimes.delete(ip);
    }
  }

  const type = String(req.body?.type || 'Client').slice(0, 40);
  const message = String(req.body?.message || 'Unknown client error').slice(0, 400);
  const page = String(req.body?.page || '/').split('?')[0].slice(0, 120);
  const source = String(req.body?.source || '').split('?')[0].slice(-160);
  const line = Number.isInteger(req.body?.line) ? req.body.line : '알 수 없음';
  scheduleBackgroundTask(
    sendDeveloperDiscordMessage([
      '[클라이언트 오류]',
      `사용자: ${req.user?.username || 'null'}`,
      `페이지: ${page}`,
      `유형: ${type}`,
      `오류: ${message}`,
      `소스: ${source || '알 수 없음'}:${line}`
    ].join('\n')),
    'Client error notification'
  );
}

// Discord webhook (환경변수 우선)
const DISCORD_WEBHOOK = process.env.DISCORD_WEBHOOK;

async function sendDiscordNotification(message, { url: pushUrl = '/' } = {}) {
  schedulePushNotification({
    title: '오늘도골대FC',
    body: message || '새로운 소식이 있습니다.',
    url: pushUrl
  });

  if (!DISCORD_WEBHOOK) return;

  try {
    const settings = await db.collection('app_settings').findOne({ _id: 'general-discord-notifications' });
    if (settings?.enabled === false) return;

    const url = new URL(DISCORD_WEBHOOK);
    const body = { content: message || '' };
    const postData = JSON.stringify(body);
    const options = {
      hostname: url.hostname,
      path: url.pathname + url.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const request = https.request(options, (response) => {
      response.resume();
    });
    request.on('error', (error) => console.error('Discord webhook error:', error));
    request.write(postData);
    request.end();
  } catch (error) {
    console.error('sendDiscordNotification error:', error);
  }
}

app.use((req, res, next) => {
  const requestMetrics = {
    requestId: crypto.randomUUID(),
    method: req.method,
    path: (req.originalUrl || req.url || '/').split('?')[0].slice(0, 160),
    startedAt: performance.now(),
    mongoRetryCount: 0,
    mongoRetryWaitMs: 0,
    mongoRetryOperationElapsedMs: 0,
    mongoRetryRecoveredOperations: 0,
    mongoRetryFailedOperations: 0,
    mongoRetryOperations: new Set()
  };
  req._requestMetrics = requestMetrics;
  res.on('finish', () => {
    if (requestMetrics.mongoRetryCount === 0) return;
    const requestDurationMs = Math.round(performance.now() - requestMetrics.startedAt);
    console.info('[MongoDB retry request summary]', JSON.stringify({
      requestId: requestMetrics.requestId,
      method: requestMetrics.method,
      path: requestMetrics.path,
      statusCode: res.statusCode,
      requestDurationMs,
      requestDurationSeconds: Number((requestDurationMs / 1000).toFixed(3)),
      mongoRetryOperations: [...requestMetrics.mongoRetryOperations],
      mongoRetryCount: requestMetrics.mongoRetryCount,
      mongoRetryWaitMs: requestMetrics.mongoRetryWaitMs,
      mongoRetryWaitSeconds: Number((requestMetrics.mongoRetryWaitMs / 1000).toFixed(3)),
      mongoRetryOperationElapsedMs: requestMetrics.mongoRetryOperationElapsedMs,
      recoveredOperations: requestMetrics.mongoRetryRecoveredOperations,
      failedOperations: requestMetrics.mongoRetryFailedOperations
    }));
  });
  requestMetricsStorage.run(requestMetrics, next);
});

app.use(methodOverride('_method'))
app.use(express.static(__dirname + '/public')) // public 폴더 내의 파일을 사용할 수 있게 함 css,js,jpg 파일들(static 파일들)
app.set('view engine', 'ejs') // ejs setting
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));
app.set('trust proxy', 1);

// passport 라이브러리 세팅
const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const MongoStore = require('connect-mongo')
const connectDB = require('./database.js')

app.use(passport.initialize())
// 세션 저장소는 MongoDB 연결에 성공한 뒤에 만든다.
// connect-mongo는 처음 받은 clientPromise를 계속 재사용하므로, 실패한 Promise를 넘기면
// 해당 인스턴스의 모든 요청이 DB 복구 후에도 계속 실패한다.
let sessionMiddleware = null;
function getSessionMiddleware(client) {
  if (!sessionMiddleware) {
    sessionMiddleware = session({
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 7 * 24 * 60 * 60 * 1000,
          secure: 'auto'
      },
      // 1 주일
      store: MongoStore.create({
        clientPromise: Promise.resolve(client),
        dbName: process.env.DB_NAME || 'goalpostagain'
      })
    })
  }
  return sessionMiddleware
}
app.use((req, res, next) => {
  connectDB()
    .then((client) => getSessionMiddleware(client)(req, res, next))
    .catch(next)
})
app.use(passport.session())

app.use((error, req, res, next) => {
  if (req.path !== '/dev/client-error') return next(error);

  reportDeveloperError(error, req);
  reportClientError(req);
  res.status(202).end();
});
//

const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3')
const multer = require('multer')
const multerS3 = require('multer-s3')
const s3 = new S3Client({
  region: 'ap-northeast-2',
  credentials: {
    accessKeyId: process.env.S3_KEY,
    secretAccessKey: process.env.S3_SECRET
  }
})

const upload = multer({
  storage: multerS3({
    s3: s3,
    bucket: process.env.S3_BUCKET,
    key: function (요청, file, cb) {
      cb(null, `${Date.now()}-${crypto.randomUUID()}`) // 파일마다 고유한 S3 키 생성
    }
  })
})

const badgeUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    key: (_req, _file, cb) => cb(null, `badges/${Date.now()}-${crypto.randomUUID()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('PNG, JPEG, WebP, GIF 이미지만 업로드할 수 있습니다.'));
  }
})

const clubLogoUpload = multer({
  storage: multerS3({
    s3,
    bucket: process.env.S3_BUCKET,
    key: (_req, _file, cb) => cb(null, `club-logos/${Date.now()}-${crypto.randomUUID()}`)
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/^image\/(png|jpeg|webp|gif)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('PNG, JPEG, WebP, GIF 이미지만 업로드할 수 있습니다.'));
  }
})

const MAX_FAVORITE_CLUBS = 12;

function getBadgeImageKey(badge) {
  if (badge.imageKey) return badge.imageKey;
  if (!badge.imageUrl) return null;

  const imageUrl = new URL(badge.imageUrl);
  let imageKey = decodeURIComponent(imageUrl.pathname.replace(/^\/+/, ''));
  const bucketPrefix = `${process.env.S3_BUCKET}/`;
  if (imageKey.startsWith(bucketPrefix)) imageKey = imageKey.slice(bucketPrefix.length);
  return imageKey;
}

let db
// 연결에 실패하면 다음 요청에서 다시 연결을 시도한다. (실패 상태를 캐시하지 않음)
function ensureDb() {
  return connectDB().then((client) => {
    if (!db) {
      console.log('DB연결성공')
      db = createRetryingDatabase(client.db(process.env.DB_NAME || 'goalpostagain'))
    }
    return db
  })
}
ensureDb().catch((err) => {
  console.error('DB 연결 실패(다음 요청에서 재시도):', err)
})
// mongoDB library 연결 코드

// cron-job.org 예약 작업: 승부예측마다 "마감 30분 전"과 "경기 시간 직후" 두 시각에만 실행되도록 예약
const CRONJOB_API_KEY = process.env.CRONJOB_API_KEY;
const CRONJOB_PREDICTION_JOB_ID = process.env.CRONJOB_PREDICTION_JOB_ID;

function getSeoulDateParts(date) {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  return {
    year: kst.getUTCFullYear(),
    month: kst.getUTCMonth() + 1,
    day: kst.getUTCDate(),
    hour: kst.getUTCHours(),
    minute: kst.getUTCMinutes()
  };
}

function buildPredictionCronSchedule(deadline, now = new Date()) {
  const runTimes = [];
  const reminderAt = new Date(deadline.getTime() - PREDICTION_REMINDER_MINUTES * 60 * 1000);
  if (reminderAt > now) runTimes.push(reminderAt);
  // 경기 시간 1분 뒤에 실행해서 마감 시각을 확실히 지난 뒤 확인
  const closeCheckAt = new Date(deadline.getTime() + 60 * 1000);
  runTimes.push(closeCheckAt);

  const parts = runTimes.map(getSeoulDateParts);
  const unique = (values) => [...new Set(values)].sort((x, y) => x - y);
  const expires = getSeoulDateParts(new Date(closeCheckAt.getTime() + 10 * 60 * 1000));
  const pad = (value) => String(value).padStart(2, '0');
  return {
    timezone: 'Asia/Seoul',
    // 시·분·일·월 조합으로 몇 번 더 실행될 수 있지만, 확인 결과가 같아서 중복 알림은 나가지 않음
    expiresAt: Number(`${expires.year}${pad(expires.month)}${pad(expires.day)}${pad(expires.hour)}${pad(expires.minute)}00`),
    months: unique(parts.map((part) => part.month)),
    mdays: unique(parts.map((part) => part.day)),
    hours: unique(parts.map((part) => part.hour)),
    minutes: unique(parts.map((part) => part.minute)),
    wdays: [-1]
  };
}

function updatePredictionCronJob(job, label) {
  if (!CRONJOB_API_KEY || !CRONJOB_PREDICTION_JOB_ID) return Promise.resolve(false);
  const postData = JSON.stringify({ job });

  const request = new Promise((resolve, reject) => {
    const apiRequest = https.request({
      hostname: 'api.cron-job.org',
      path: `/jobs/${encodeURIComponent(CRONJOB_PREDICTION_JOB_ID)}`,
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${CRONJOB_API_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    }, (response) => {
      response.resume();
      response.on('end', () => {
        if (response.statusCode >= 200 && response.statusCode < 300) return resolve(true);
        reject(new Error(`cron-job.org 응답 ${response.statusCode}`));
      });
    });
    apiRequest.on('error', reject);
    apiRequest.setTimeout(5000, () => apiRequest.destroy(new Error('cron-job.org 요청 시간 초과')));
    apiRequest.write(postData);
    apiRequest.end();
  }).catch((error) => {
    console.error(`승부예측 예약 ${label} 실패:`, error.message);
    scheduleBackgroundTask(
      sendDeveloperDiscordMessage(`[개발자 알림] 승부예측 예약 ${label} 실패\n${error.message}`),
      'Prediction cron update failure notification'
    );
    return false;
  });

  scheduleBackgroundTask(request, `Prediction cron ${label}`);
  return request;
}

function schedulePredictionCron(prediction) {
  const deadline = getPredictionDeadline(prediction);
  if (!deadline || deadline <= new Date()) return Promise.resolve(false);
  return updatePredictionCronJob({ enabled: true, schedule: buildPredictionCronSchedule(deadline) }, '등록');
}

function disablePredictionCron() {
  return updatePredictionCronJob({ enabled: false }, '해제');
}

// 승부예측 경기 시간(한국 시간) 문자열을 Date로 변환. 예: "2026년 10월 6일 20시 00분", "2026-10-06 20:00"
function parsePredictionMatchTime(text) {
  const value = String(text || '');
  const numbers = (value.match(/\d+/g) || []).map(Number);
  if (numbers.length < 4) return null;
  let [year, month, day, hour, minute = 0] = numbers;
  if (year < 100) year += 2000;
  if (/오후|PM/i.test(value) && hour < 12) hour += 12;
  if (/오전|AM/i.test(value) && hour === 12) hour = 0;
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const date = new Date(Date.UTC(year, month - 1, day, hour - 9, minute));
  return Number.isNaN(date.getTime()) ? null : date;
}

function getPredictionDeadline(prediction) {
  if (!prediction) return null;
  if (prediction.matchTimeAt) return new Date(prediction.matchTimeAt);
  return parsePredictionMatchTime(prediction.matchTime);
}

function isPredictionPastDeadline(prediction, now = new Date()) {
  if (!prediction || prediction.autoCloseSkipped) return false;
  const deadline = getPredictionDeadline(prediction);
  return Boolean(deadline) && now >= deadline;
}

async function notifyPredictionClosed(prediction, { auto = false } = {}) {
  const voteCount = await db.collection('prediction_votes').countDocuments({ settingId: String(prediction._id) });
  sendDiscordNotification(
    [
      `[${prediction.homeTeam} vs ${prediction.awayTeam}] ${auto ? '경기 시작 시간이 되어 승부예측이 마감되었습니다.' : '승부예측이 마감되었습니다.'}`,
      `경기 시간: ${prediction.matchTime}`,
      `참여 인원: ${voteCount}명`
    ].join('\n'),
    { url: '/prediction' }
  );
}

// 경기 시간이 지났는데 아직 열려 있으면 마감 처리 (요청 시점에 확인하는 방식)
async function closePredictionIfExpired(prediction) {
  if (!prediction || prediction.isOpen === false || !isPredictionPastDeadline(prediction)) return prediction;
  const closedAt = new Date();
  const result = await db.collection('prediction_setting').updateOne(
    { _id: prediction._id, isOpen: { $ne: false } },
    { $set: { isOpen: false, autoClosedAt: closedAt, updatedAt: closedAt } }
  );
  if (result.modifiedCount === 1) {
    disablePredictionCron();
    logActivity('시스템', '승부예측 자동 마감', `- ${prediction.homeTeam} vs ${prediction.awayTeam} (${prediction.matchTime})`);
    try {
      await notifyPredictionClosed(prediction, { auto: true });
    } catch (error) {
      console.error('승부예측 자동 마감 알림 실패:', error.message);
    }
  }
  return { ...prediction, isOpen: false, autoClosedAt: prediction.autoClosedAt || closedAt };
}

const PREDICTION_REMINDER_MINUTES = 30;

// 마감 30분 이내로 들어오면 "마감 임박" 알림을 한 번만 발송
async function sendPredictionReminderIfDue(prediction, now = new Date()) {
  if (!prediction || prediction.isOpen === false || prediction.reminderSentAt) return prediction;
  const deadline = getPredictionDeadline(prediction);
  if (!deadline) return prediction;
  const msLeft = deadline.getTime() - now.getTime();
  if (msLeft <= 0 || msLeft > (PREDICTION_REMINDER_MINUTES + 1) * 60 * 1000) return prediction;

  const result = await db.collection('prediction_setting').updateOne(
    { _id: prediction._id, isOpen: { $ne: false }, reminderSentAt: null },
    { $set: { reminderSentAt: now } }
  );
  if (result.modifiedCount === 1) {
    const minutesLeft = Math.max(1, Math.round(msLeft / 60000));
    const voteCount = await db.collection('prediction_votes').countDocuments({ settingId: String(prediction._id) });
    sendDiscordNotification(
      [
        `[${prediction.homeTeam} vs ${prediction.awayTeam}] 승부예측 마감 ${minutesLeft >= PREDICTION_REMINDER_MINUTES - 2 ? PREDICTION_REMINDER_MINUTES : minutesLeft}분 전입니다.`,
        `경기 시간: ${prediction.matchTime}`,
        `현재 참여 인원: ${voteCount}명 · 아직 예측하지 않았다면 지금 참여해주세요!`
      ].join('\n'),
      { url: '/prediction' }
    );
    logActivity('시스템', '승부예측 마감 임박 알림', `- ${prediction.homeTeam} vs ${prediction.awayTeam} (${minutesLeft}분 전)`);
  }
  return { ...prediction, reminderSentAt: prediction.reminderSentAt || now };
}

async function getCurrentPrediction() {
  const prediction = await db.collection('prediction_setting').findOne({}, { sort: { _id: -1 } });
  const checkedPrediction = await closePredictionIfExpired(prediction);
  return sendPredictionReminderIfDue(checkedPrediction);
}

async function getUserClubEmblems(userID) {
  const favorites = await db.collection('user_club_favorites').findOne({ userID }, { projection: { clubLogoIds: 1 } });
  if (!favorites?.clubLogoIds?.length) return [];

  const logos = await db.collection('club_logos').find(
    { _id: { $in: favorites.clubLogoIds } },
    { projection: { name: 1, imageUrl: 1 } }
  ).toArray();
  const logoById = new Map(logos.map((logo) => [String(logo._id), logo]));
  return favorites.clubLogoIds
    .map((id) => logoById.get(String(id)))
    .filter(Boolean)
    .map((logo) => ({ clubName: logo.name, imageUrl: logo.imageUrl }));
}

app.use(async (req, res, next) => {
  if (req.path === '/dev/client-error') return next();

  try {
    await ensureDb()
    next()
  } catch (error) {
    next(error)
  }
})

app.use(async (req, res, next) => {
  if (req.path === '/dev/client-error') return next();

  const username = req.user?.username;
  if (!username || !req.session) return next();

  const today = getSeoulDateKey();
  if (req.session.lastActivityTrackedDate === today) return next();

  try {
    await db.collection('daily_active_users').updateOne(
      { _id: today },
      { $setOnInsert: { date: today }, $addToSet: { usernames: username } },
      { upsert: true }
    );
    req.session.lastActivityTrackedDate = today;
  } catch (error) {
    reportDeveloperError(error, req);
  }
  next();
});

app.use((req, res, next) => {
  res.on('finish', () => {
    if (res.statusCode >= 500) {
      reportDeveloperError(new Error(`HTTP ${res.statusCode} response`), req);
    }
  });
  next();
});

app.get('/push/public-key', (req, res) => {
  if (!isPushConfigured()) {
    reportDeveloperError(new Error('Web push VAPID keys are not configured'), req);
    return res.status(503).json({ ok: false, message: '웹 푸시 환경변수가 설정되지 않았습니다.' });
  }

  res.json({ ok: true, publicKey: PUSH_PUBLIC_KEY });
});

app.get('/push/preferences', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }

  const subscriptionCount = await db.collection('push_subscription').countDocuments({ username: req.user.username });
  res.json({
    ok: true,
    enabled: req.user.pushNotificationsEnabled !== false && subscriptionCount > 0
  });
});

app.put('/push/preferences', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }
  if (typeof req.body?.enabled !== 'boolean') {
    return res.status(400).json({ ok: false, message: '알림 설정값이 올바르지 않습니다.' });
  }

  await db.collection('user').updateOne(
    { _id: req.user._id },
    { $set: { pushNotificationsEnabled: req.body.enabled } }
  );
  res.json({ ok: true, enabled: req.body.enabled });
});

app.post('/push/subscribe', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }
  if (!isPushConfigured()) {
    reportDeveloperError(new Error('Web push VAPID keys are not configured'), req);
    return res.status(503).json({ ok: false, message: '웹 푸시 환경변수가 설정되지 않았습니다.' });
  }

  const subscription = req.body?.subscription;
  if (!subscription?.endpoint || !subscription?.keys?.p256dh || !subscription?.keys?.auth) {
    return res.status(400).json({ ok: false, message: '유효하지 않은 푸시 구독 정보입니다.' });
  }

  const subscriptionResult = await db.collection('push_subscription').updateOne(
    { endpoint: subscription.endpoint },
    {
      $set: {
        endpoint: subscription.endpoint,
        subscription,
        username: req.user?.username || null,
        updatedAt: new Date()
      }
    },
    { upsert: true }
  );
  await db.collection('user').updateOne(
    { _id: req.user._id },
    { $set: { pushNotificationsEnabled: true } }
  );

  if (subscriptionResult.upsertedCount > 0) {
    const deviceCount = await db.collection('push_subscription').countDocuments({ username: req.user.username });
    scheduleBackgroundTask(
      sendDeveloperDiscordMessage([
        '[웹푸시 구독 추가]',
        `사용자: ${req.user.username}`,
        `등록 기기 수: ${deviceCount}대`
      ].join('\n')),
      'New push subscription notification'
    );
  }

  res.json({ ok: true, message: '알림이 설정되었습니다.' });
});

app.delete('/push/subscribe', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }

  const endpoint = req.body?.endpoint;
  if (typeof endpoint !== 'string' || !endpoint.startsWith('https://') || endpoint.length > 4096) {
    return res.status(400).json({ ok: false, message: '유효하지 않은 기기 구독 정보입니다.' });
  }

  try {
    const result = await db.collection('push_subscription').deleteOne({
      endpoint,
      username: req.user.username
    });
    res.json({ ok: true, removed: result.deletedCount > 0 });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('현재 기기 푸시 구독 해제 실패:', error);
    res.status(500).json({ ok: false, message: '이 기기의 알림 구독을 해제하지 못했습니다.' });
  }
});

app.post('/dev/client-error', (req, res) => {
  reportClientError(req);
  res.status(202).end();
});

app.get('/error', (req, res) => {
  res.status(500).render('error.ejs');
});


// 로깅 함수
function logActivity(username, action, details = '') {
  const timeZone = 'Asia/Seoul';
  const timestamp = new Date().toLocaleString('ko-KR', { timeZone });
  const logMessage = `[${timestamp}] 사용자: ${username} | 작업: ${action} ${details}`;
  console.log(logMessage);
}


app.use((req, res, next) => {
  if (req.user) {
    res.locals.유저 = req.user || {};
  }
  next();
})

app.get('/api/cron/prediction-reminders', async (req, res) => {
  if (!CRON_SECRET || req.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }

  try {
    const prediction = await getCurrentPrediction();
    const deadline = getPredictionDeadline(prediction);
    // 확인할 승부예측이 없으면 예약 작업을 꺼서 불필요한 호출을 멈춤 (끄기 실패 대비 안전장치)
    if (!prediction || prediction.isOpen === false) await disablePredictionCron();
    res.json({
      ok: true,
      hasPrediction: Boolean(prediction),
      isOpen: prediction ? prediction.isOpen !== false : null,
      deadline: deadline ? deadline.toISOString() : null,
      reminderSent: Boolean(prediction?.reminderSentAt)
    });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('승부예측 예약 확인 실패:', error);
    res.status(500).json({ ok: false, message: '승부예측 예약 확인에 실패했습니다.' });
  }
});

app.get('/api/cron/daily-active-users', async (req, res) => {
  if (!CRON_SECRET || req.get('authorization') !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ ok: false, message: 'Unauthorized' });
  }
  if (!DEV_DISCORD_WEBHOOK) {
    return res.status(503).json({ ok: false, message: 'Developer Discord webhook is not configured' });
  }

  const targetDate = getSeoulDateKey(new Date(Date.now() - 24 * 60 * 60 * 1000));
  const activity = await db.collection('daily_active_users').findOne({ _id: targetDate });
  const usernames = activity?.usernames || [];
  const header = `[전일 접속 사용자] ${targetDate} · ${usernames.length}명`;
  const chunks = [];
  let currentMessage = header;

  for (const username of usernames) {
    const line = `\n• ${username}`;
    if (currentMessage.length + line.length > 1750) {
      chunks.push(currentMessage);
      currentMessage = `[전일 접속 사용자] ${targetDate} (계속)${line}`;
    } else {
      currentMessage += line;
    }
  }
  chunks.push(currentMessage);

  for (const message of chunks) {
    await sendDeveloperDiscordMessage(message);
  }

  res.json({ ok: true, date: targetDate, activeUserCount: usernames.length });
});



app.get('/', async (req, res) => {
  const [mvpResult, matchResult, matchplan, mvpboardResult] = await Promise.all([
    db.collection('mvp').find({}, { projection: { mvp: 1 } }).sort({ _id: -1 }).limit(1).toArray(),
    db.collection('result').find({}, {
      projection: {
        awayname: 1,
        year: 1,
        month: 1,
        day: 1,
        homescore: 1,
        awayscore: 1,
        home_resultlogo: 1
      }
    }).sort({ _id: -1 }).limit(3).toArray(),
    db.collection('matchplan').find({}, {
      projection: {
        month: 1,
        date: 1,
        day: 1,
        time: 1,
        timeto: 1,
        awayteam: 1,
        place: 1,
        address: 1
      }
    }).sort({ _id: -1 }).limit(1).toArray(),
    db.collection('mvpboard').find({}, { projection: { member_score: 1 } }).sort({ _id: -1 }).limit(1).toArray()
  ]);

  const Weeklymvp = mvpResult.length > 0 ? mvpResult[0].mvp : null;
  const mvpboard = mvpboardResult.length > 0 ? mvpboardResult[0].member_score : {};

  res.render('home.ejs', { MVP: Weeklymvp, 매치일정: matchplan, result: matchResult, mvpboard });
})



app.get('/management', async (req, res) => {
  const isDeveloper = req.user?.userID === DEVELOPER_USER_ID;
  const canSeeStats = isDeveloper || req.user?.username === '한대규';
  const developerBadgeUsers = isDeveloper
    ? await db.collection('user').find({ isWithdrawn: { $ne: true } }, { projection: { userID: 1, username: 1 } }).sort({ username: 1 }).toArray()
    : [];
  const withdrawnUsers = isDeveloper
    ? await db.collection('user').find({ isWithdrawn: true }, { projection: { userID: 1, username: 1, withdrawnAt: 1 } }).sort({ username: 1 }).toArray()
    : [];
  const developerBadges = isDeveloper
    ? await db.collection('user_badges').find({}, {
      projection: { userID: 1, username: 1, imageUrl: 1, description: 1, createdAt: 1 }
    }).sort({ createdAt: -1 }).toArray()
    : [];
  const [developerClubLogos, developerClubFavorites] = isDeveloper
    ? await Promise.all([
      db.collection('club_logos').find({}, { projection: { name: 1, imageUrl: 1 } }).sort({ name: 1 }).toArray(),
      db.collection('user_club_favorites').find({}, { projection: { userID: 1, clubLogoIds: 1 } }).toArray()
    ])
    : [[], []];
  const generalDiscordSettings = isDeveloper
    ? await db.collection('app_settings').findOne({ _id: 'general-discord-notifications' })
    : null;
  const generalDiscordNotificationsEnabled = generalDiscordSettings?.enabled !== false;

  let result = await db.collection('notice').find().toArray();
  let matchplan = await db.collection('matchplan').find().sort({ _id: -1 }).toArray();
  let latestResult = await db.collection('result').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;
  let lastSavedTime = mvpboardDic[0].savedTime || '저장된 시간 없음';
  let lastSavedUsername = mvpboardDic[0].savedUsername || '저장한 사람 없음';
  let predictionSetting = await getCurrentPrediction();
  const predictionLeaderboard = await getPredictionLeaderboard();
  const predictionHistory = await db.collection('prediction_history').find({}).sort({ archivedAt: -1 }).toArray();


  let avgStats = await db.collection('stats_result_pure').aggregate([
    {
      $group: {
        _id: null,
        avg_stat1: { $avg: "$avg_stat1" },
        avg_stat2: { $avg: "$avg_stat2" },
        avg_stat3: { $avg: "$avg_stat3" },
        avg_stat4: { $avg: "$avg_stat4" },
        avg_stat5: { $avg: "$avg_stat5" },
        avg_stat6: { $avg: "$avg_stat6" },
        avg_stat7: { $avg: "$avg_stat7" },
        avg_stat8: { $avg: "$avg_stat8" },
        avg_stat9: { $avg: "$avg_stat9" },
        avg_stat10: { $avg: "$avg_stat10" },
        avg_stat11: { $avg: "$avg_stat11" },
        avg_stat12: { $avg: "$avg_stat12" },
        avg_stat13: { $avg: "$avg_stat13" },
        avg_stat14: { $avg: "$avg_stat14" },
        avg_stat15: { $avg: "$avg_stat15" },
        avg_stat16: { $avg: "$avg_stat16" },
        avg_stat17: { $avg: "$avg_stat17" },
        avg_stat18: { $avg: "$avg_stat18" }
      }
    }
  ]).toArray();

  // Extract the averages from the result
  let avgStatsResult = avgStats[0];

  const pushEnabledUsernames = canSeeStats
    ? (await db.collection('push_subscription').distinct('username', { username: { $type: 'string', $ne: '' } })).sort((first, second) => first.localeCompare(second, 'ko'))
    : [];
  const todayActiveRecord = canSeeStats
    ? await db.collection('daily_active_users').findOne({ _id: getSeoulDateKey() })
    : null;
  const mvpAwardLeaderboard = canSeeStats
    ? await db.collection('mvp').aggregate([
      { $match: { mvp_name: { $type: 'string', $ne: '' } } },
      { $group: { _id: '$mvp_name', awardCount: { $sum: 1 } } },
      { $sort: { awardCount: -1, _id: 1 } },
      { $limit: 10 },
      { $project: { _id: 0, username: '$_id', awardCount: 1 } }
    ]).toArray()
    : [];

  const canManage = isDeveloper || ['한대규', '관리자', '양철진', '안태훈', '김정훈'].includes(req.user?.username);
  res.render('management.ejs', { 글목록: result, 매치일정: matchplan, latestResult: latestResult[0] || null, mvpboard: mvpboard, avgStatsResult: avgStatsResult, lastSavedTime: lastSavedTime, lastSavedUsername: lastSavedUsername, predictionSetting: predictionSetting || null, predictionLeaderboard, predictionHistory, pushEnabledUsernames, isDeveloper, canSeeStats, canManage, todayActiveUsernames: todayActiveRecord?.usernames || [], generalDiscordNotificationsEnabled, mvpAwardLeaderboard, developerBadgeUsers, developerBadges, withdrawnUsers, developerClubLogos, developerClubFavorites, clubFavoriteLimit: MAX_FAVORITE_CLUBS });
});

app.post('/developer/badges', (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }

  badgeUpload.single('badgeImage')(req, res, async (uploadError) => {
    if (uploadError) {
      const isUploadLimitError = uploadError instanceof multer.MulterError;
      const isUnsupportedImage = uploadError.message.includes('이미지만');
      const statusCode = isUploadLimitError || isUnsupportedImage ? 400 : 500;
      if (statusCode === 500) reportDeveloperError(uploadError, req);
      return res.status(statusCode).json({
        ok: false,
        message: isUploadLimitError && uploadError.code === 'LIMIT_FILE_SIZE'
          ? '이미지는 5MB 이하로 업로드해주세요.'
          : uploadError.message
      });
    }

    const { userID, description } = req.body || {};
    const normalizedDescription = String(description || '').trim();
    const uploadedFile = req.file;
    const removeUploadedFile = async () => {
      if (!uploadedFile?.key) return;
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: uploadedFile.key }));
      } catch (error) {
        console.error('업로드한 뱃지 이미지 정리 실패:', error.message);
      }
    };

    if (!userID || !normalizedDescription || normalizedDescription.length > 200 || !uploadedFile) {
      await removeUploadedFile();
      return res.status(400).json({ ok: false, message: '회원, 이미지, 1~200자 설명을 모두 입력해주세요.' });
    }

    try {
      const targetUser = await db.collection('user').findOne({ userID }, { projection: { username: 1 } });
      if (!targetUser) {
        await removeUploadedFile();
        return res.status(404).json({ ok: false, message: '선택한 회원을 찾을 수 없습니다.' });
      }

      await db.collection('user_badges').insertOne({
        userID,
        username: targetUser.username,
        imageUrl: uploadedFile.location,
        imageKey: uploadedFile.key,
        description: normalizedDescription,
        createdAt: new Date(),
        createdBy: req.user.userID
      });
      logActivity(req.user.username, '회원 뱃지 부여', `- 대상: ${targetUser.username}`);
      res.json({ ok: true, message: `${targetUser.username}님에게 뱃지를 부여했습니다.` });
    } catch (error) {
      await removeUploadedFile();
      reportDeveloperError(error, req);
      console.error('회원 뱃지 저장 실패:', error);
      res.status(500).json({ ok: false, message: '뱃지를 저장하지 못했습니다.' });
    }
  });
});

app.put('/developer/badges/:id', (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ ok: false, message: '뱃지 정보가 올바르지 않습니다.' });
  }

  badgeUpload.single('badgeImage')(req, res, async (uploadError) => {
    if (uploadError) {
      const isUploadLimitError = uploadError instanceof multer.MulterError;
      const isUnsupportedImage = uploadError.message.includes('이미지만');
      const statusCode = isUploadLimitError || isUnsupportedImage ? 400 : 500;
      if (statusCode === 500) reportDeveloperError(uploadError, req);
      return res.status(statusCode).json({
        ok: false,
        message: isUploadLimitError && uploadError.code === 'LIMIT_FILE_SIZE'
          ? '이미지는 5MB 이하로 업로드해주세요.'
          : uploadError.message
      });
    }

    const badgeId = new ObjectId(req.params.id);
    const uploadedFile = req.file;
    const description = String(req.body?.description || '').trim();
    const removeUploadedImage = async () => {
      if (!uploadedFile?.key) return;
      try {
        await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: uploadedFile.key }));
      } catch (error) {
        console.error('수정 실패 뱃지 이미지 정리 실패:', error.message);
      }
    };

    if (!description || description.length > 200) {
      await removeUploadedImage();
      return res.status(400).json({ ok: false, message: '뱃지 설명은 1~200자로 입력해주세요.' });
    }

    try {
      const badgeCollection = db.collection('user_badges');
      const badge = await badgeCollection.findOne({ _id: badgeId });
      if (!badge) {
        await removeUploadedImage();
        return res.status(404).json({ ok: false, message: '뱃지를 찾을 수 없습니다.' });
      }

      const updatedFields = {
        description,
        updatedAt: new Date(),
        updatedBy: req.user.userID
      };
      if (uploadedFile) {
        updatedFields.imageUrl = uploadedFile.location;
        updatedFields.imageKey = uploadedFile.key;
      }

      await badgeCollection.updateOne({ _id: badgeId }, { $set: updatedFields });

      if (uploadedFile) {
        try {
          const previousImageKey = getBadgeImageKey(badge);
          if (previousImageKey && previousImageKey !== uploadedFile.key) {
            await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: previousImageKey }));
          }
        } catch (error) {
          console.error('이전 뱃지 이미지 정리 실패:', error.message);
        }
      }

      logActivity(req.user.username, '회원 뱃지 수정', `- 대상: ${badge.username || badge.userID}`);
      res.json({
        ok: true,
        badge: {
          imageUrl: updatedFields.imageUrl || badge.imageUrl,
          description
        }
      });
    } catch (error) {
      await removeUploadedImage();
      reportDeveloperError(error, req);
      console.error('회원 뱃지 수정 실패:', error);
      res.status(500).json({ ok: false, message: '뱃지를 수정하지 못했습니다.' });
    }
  });
});

app.delete('/developer/badges/:id', async (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ ok: false, message: '뱃지 정보가 올바르지 않습니다.' });
  }

  try {
    const badgeCollection = db.collection('user_badges');
    const badge = await badgeCollection.findOne({ _id: new ObjectId(req.params.id) });
    if (!badge) return res.status(404).json({ ok: false, message: '뱃지를 찾을 수 없습니다.' });

    // 뱃지 기록만 지워 화면에서 뺀다. S3 이미지 파일은 삭제하지 않고 남겨둔다.
    await badgeCollection.deleteOne({ _id: badge._id });
    logActivity(req.user.username, '회원 뱃지 제거', `- 대상: ${badge.username || badge.userID}`);
    res.json({ ok: true });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('회원 뱃지 제거 실패:', error);
    res.status(500).json({ ok: false, message: '뱃지를 제거하지 못했습니다.' });
  }
});

function clubLogoDeveloperOnly(req, res, next) {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }
  next();
}

function receiveClubLogoImage(req, res, next) {
  clubLogoUpload.single('clubLogoImage')(req, res, (uploadError) => {
    if (!uploadError) return next();
    const isUploadLimitError = uploadError instanceof multer.MulterError;
    const isUnsupportedImage = uploadError.message.includes('이미지만');
    const statusCode = isUploadLimitError || isUnsupportedImage ? 400 : 500;
    if (statusCode === 500) reportDeveloperError(uploadError, req);
    res.status(statusCode).json({
      ok: false,
      message: isUploadLimitError && uploadError.code === 'LIMIT_FILE_SIZE'
        ? '로고 이미지는 5MB 이하로 업로드해주세요.'
        : uploadError.message
    });
  });
}

async function deleteClubLogoImageQuietly(imageKey) {
  if (!imageKey) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET, Key: imageKey }));
  } catch (error) {
    console.error('클럽 로고 이미지 정리 실패:', error.message);
  }
}

function parseClubLogoIds(value) {
  if (!Array.isArray(value) || value.length > MAX_FAVORITE_CLUBS) return null;
  const ids = value.map(String);
  if (new Set(ids).size !== ids.length || !ids.every((id) => ObjectId.isValid(id))) return null;
  return ids.map((id) => new ObjectId(id));
}

app.post('/developer/club-logos', clubLogoDeveloperOnly, receiveClubLogoImage, async (req, res) => {
  const name = String(req.body?.name || '').trim();
  const uploadedFile = req.file;
  if (!name || name.length > 60 || !uploadedFile) {
    await deleteClubLogoImageQuietly(uploadedFile?.key);
    return res.status(400).json({ ok: false, message: '클럽 이름과 로고 이미지를 입력해주세요. 클럽 이름은 60자 이내여야 합니다.' });
  }

  try {
    const logos = db.collection('club_logos');
    const nameKey = name.toLowerCase();
    if (await logos.findOne({ nameKey }, { projection: { _id: 1 } })) {
      await deleteClubLogoImageQuietly(uploadedFile.key);
      return res.status(409).json({ ok: false, message: '같은 이름의 클럽 로고가 이미 목록에 있습니다.' });
    }

    const now = new Date();
    const result = await logos.insertOne({
      name,
      nameKey,
      imageUrl: uploadedFile.location,
      imageKey: uploadedFile.key,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.userID
    });
    logActivity(req.user.username, '클럽 로고 추가', `- ${name}`);
    res.json({
      ok: true,
      message: `${name} 로고를 목록에 추가했습니다.`,
      logo: { _id: result.insertedId, name, imageUrl: uploadedFile.location }
    });
  } catch (error) {
    await deleteClubLogoImageQuietly(uploadedFile.key);
    reportDeveloperError(error, req);
    console.error('클럽 로고 추가 실패:', error);
    res.status(500).json({ ok: false, message: '클럽 로고를 추가하지 못했습니다.' });
  }
});

app.put('/developer/club-logos/:id', clubLogoDeveloperOnly, receiveClubLogoImage, async (req, res) => {
  const uploadedFile = req.file;
  const name = String(req.body?.name || '').trim();
  if (!ObjectId.isValid(req.params.id) || !name || name.length > 60) {
    await deleteClubLogoImageQuietly(uploadedFile?.key);
    return res.status(400).json({ ok: false, message: '클럽 이름은 1~60자로 입력해주세요.' });
  }

  try {
    const logos = db.collection('club_logos');
    const logo = await logos.findOne({ _id: new ObjectId(req.params.id) });
    if (!logo) {
      await deleteClubLogoImageQuietly(uploadedFile?.key);
      return res.status(404).json({ ok: false, message: '클럽 로고를 찾을 수 없습니다.' });
    }

    const nameKey = name.toLowerCase();
    if (await logos.findOne({ nameKey, _id: { $ne: logo._id } }, { projection: { _id: 1 } })) {
      await deleteClubLogoImageQuietly(uploadedFile?.key);
      return res.status(409).json({ ok: false, message: '같은 이름의 클럽 로고가 이미 목록에 있습니다.' });
    }

    const update = { name, nameKey, updatedAt: new Date() };
    if (uploadedFile) {
      update.imageUrl = uploadedFile.location;
      update.imageKey = uploadedFile.key;
    }
    await logos.updateOne({ _id: logo._id }, { $set: update });
    if (uploadedFile) await deleteClubLogoImageQuietly(getBadgeImageKey(logo));

    const changes = [logo.name !== name ? `${logo.name} → ${name}` : name, uploadedFile ? '(이미지 변경)' : ''].join(' ').trim();
    logActivity(req.user.username, '클럽 로고 수정', `- ${changes}`);
    res.json({
      ok: true,
      message: `${name} 로고를 수정했습니다.`,
      logo: { _id: logo._id, name, imageUrl: update.imageUrl || logo.imageUrl }
    });
  } catch (error) {
    await deleteClubLogoImageQuietly(uploadedFile?.key);
    reportDeveloperError(error, req);
    console.error('클럽 로고 수정 실패:', error);
    res.status(500).json({ ok: false, message: '클럽 로고를 수정하지 못했습니다.' });
  }
});

app.delete('/developer/club-logos/:id', clubLogoDeveloperOnly, async (req, res) => {
  if (!ObjectId.isValid(req.params.id)) {
    return res.status(400).json({ ok: false, message: '클럽 로고 정보가 올바르지 않습니다.' });
  }

  try {
    const logos = db.collection('club_logos');
    const logo = await logos.findOne({ _id: new ObjectId(req.params.id) });
    if (!logo) return res.status(404).json({ ok: false, message: '클럽 로고를 찾을 수 없습니다.' });

    await db.collection('user_club_favorites').updateMany(
      { clubLogoIds: logo._id },
      { $pull: { clubLogoIds: logo._id } }
    );
    await logos.deleteOne({ _id: logo._id });
    await deleteClubLogoImageQuietly(getBadgeImageKey(logo));
    logActivity(req.user.username, '클럽 로고 삭제', `- ${logo.name}`);
    res.json({ ok: true, message: `${logo.name} 로고를 목록에서 삭제했습니다.` });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('클럽 로고 삭제 실패:', error);
    res.status(500).json({ ok: false, message: '클럽 로고를 삭제하지 못했습니다.' });
  }
});

app.put('/developer/club-favorites/:userID', clubLogoDeveloperOnly, async (req, res) => {
  const clubLogoIds = parseClubLogoIds(req.body?.clubLogoIds);
  if (!clubLogoIds) {
    return res.status(400).json({ ok: false, message: `클럽 목록이 올바르지 않습니다. 한 회원당 최대 ${MAX_FAVORITE_CLUBS}개까지 등록할 수 있습니다.` });
  }

  try {
    const targetUser = await db.collection('user').findOne(
      { userID: req.params.userID, isWithdrawn: { $ne: true } },
      { projection: { userID: 1, username: 1 } }
    );
    if (!targetUser) return res.status(404).json({ ok: false, message: '활성 회원을 찾을 수 없습니다.' });

    if (clubLogoIds.length > 0) {
      const existingCount = await db.collection('club_logos').countDocuments({ _id: { $in: clubLogoIds } });
      if (existingCount !== clubLogoIds.length) {
        return res.status(400).json({ ok: false, message: '목록에 없는 클럽이 포함되어 있습니다. 새로고침 후 다시 시도해주세요.' });
      }
    }

    const favorites = db.collection('user_club_favorites');
    if (clubLogoIds.length === 0) {
      await favorites.deleteOne({ userID: targetUser.userID });
    } else {
      await favorites.updateOne(
        { userID: targetUser.userID },
        { $set: { username: targetUser.username, clubLogoIds, updatedAt: new Date(), updatedBy: req.user.userID } },
        { upsert: true }
      );
    }
    logActivity(req.user.username, '클럽 엠블럼 일괄 등록', `- 대상: ${targetUser.username} / ${clubLogoIds.length}개`);
    res.json({
      ok: true,
      message: clubLogoIds.length > 0
        ? `${targetUser.username}님의 클럽 엠블럼 ${clubLogoIds.length}개를 저장했습니다.`
        : `${targetUser.username}님의 클럽 엠블럼을 모두 해제했습니다.`,
      clubLogoIds: clubLogoIds.map(String)
    });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('클럽 엠블럼 일괄 등록 실패:', error);
    res.status(500).json({ ok: false, message: '클럽 엠블럼을 저장하지 못했습니다.' });
  }
});

app.delete('/developer/users/:userID', async (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }

  const targetUserID = String(req.params.userID || '').trim();
  const confirmUsername = String(req.body?.confirmUsername || '').trim();
  if (!targetUserID) {
    return res.status(400).json({ ok: false, message: '탈퇴시킬 회원을 선택해주세요.' });
  }
  if (targetUserID === DEVELOPER_USER_ID || targetUserID === req.user.userID) {
    return res.status(400).json({ ok: false, message: '개발자 계정은 탈퇴시킬 수 없습니다.' });
  }

  try {
    const userCollection = db.collection('user');
    const targetUser = await userCollection.findOne({ userID: targetUserID }, { projection: { userID: 1, username: 1 } });
    if (!targetUser) {
      return res.status(404).json({ ok: false, message: '회원을 찾을 수 없습니다. 이미 탈퇴 처리되었을 수 있습니다.' });
    }
    if (confirmUsername !== targetUser.username) {
      return res.status(400).json({ ok: false, message: '확인용 이름이 회원 이름과 일치하지 않습니다.' });
    }

    const withdrawalResult = await userCollection.updateOne(
      { _id: targetUser._id, isWithdrawn: { $ne: true } },
      {
        $set: {
          isWithdrawn: true,
          withdrawnAt: new Date(),
          withdrawnBy: req.user.userID,
          pushNotificationsEnabled: false
        }
      }
    );
    if (withdrawalResult.modifiedCount === 0) {
      return res.status(409).json({ ok: false, message: '이미 탈퇴 처리된 회원입니다.' });
    }

    if (targetUser.username) {
      try {
        await db.collection('push_subscription').deleteMany({ username: targetUser.username });
      } catch (error) {
        console.error('탈퇴 회원 푸시 구독 정리 실패:', error.message);
      }
    }

    logActivity(req.user.username, '회원 탈퇴 처리', `- 대상: ${targetUser.username} (${targetUserID})`);
    res.json({ ok: true, userID: targetUserID, message: `${targetUser.username}님을 탈퇴 처리했습니다. 회원 기록과 뱃지는 보존됩니다.` });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('회원 탈퇴 처리 실패:', error);
    res.status(500).json({ ok: false, message: '회원 탈퇴를 처리하지 못했습니다.' });
  }
});

app.post('/developer/users/:userID/restore', async (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }

  const targetUserID = String(req.params.userID || '').trim();
  const confirmUsername = String(req.body?.confirmUsername || '').trim();
  if (!targetUserID || targetUserID === DEVELOPER_USER_ID) {
    return res.status(400).json({ ok: false, message: '복원할 회원을 선택해주세요.' });
  }

  try {
    const userCollection = db.collection('user');
    const targetUser = await userCollection.findOne(
      { userID: targetUserID, isWithdrawn: true },
      { projection: { userID: 1, username: 1 } }
    );
    if (!targetUser) {
      return res.status(404).json({ ok: false, message: '탈퇴 처리된 회원을 찾을 수 없습니다.' });
    }
    if (confirmUsername !== targetUser.username) {
      return res.status(400).json({ ok: false, message: '확인용 이름이 회원 이름과 일치하지 않습니다.' });
    }

    const restoreResult = await userCollection.updateOne(
      { _id: targetUser._id, isWithdrawn: true },
      {
        $set: {
          isWithdrawn: false,
          restoredAt: new Date(),
          restoredBy: req.user.userID,
          pushNotificationsEnabled: false
        }
      }
    );
    if (restoreResult.modifiedCount === 0) {
      return res.status(409).json({ ok: false, message: '이미 복원된 회원입니다.' });
    }

    logActivity(req.user.username, '회원 복원 처리', `- 대상: ${targetUser.username} (${targetUserID})`);
    res.json({ ok: true, userID: targetUserID, username: targetUser.username, message: `${targetUser.username}님을 복원했습니다. 푸시 알림은 다시 구독해야 합니다.` });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('회원 복원 처리 실패:', error);
    res.status(500).json({ ok: false, message: '회원 복원을 처리하지 못했습니다.' });
  }
});

app.post('/developer/general-discord-notifications', async (req, res) => {
  if (req.user?.userID !== DEVELOPER_USER_ID) {
    return res.status(403).json({ ok: false, message: '개발자 권한이 필요합니다.' });
  }

  const { enabled } = req.body || {};
  if (typeof enabled !== 'boolean') {
    return res.status(400).json({ ok: false, message: '알림 상태가 올바르지 않습니다.' });
  }

  try {
    await db.collection('app_settings').updateOne(
      { _id: 'general-discord-notifications' },
      { $set: { enabled, updatedAt: new Date(), updatedBy: req.user.username } },
      { upsert: true }
    );
    res.json({ ok: true, enabled });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('일반 Discord 알림 설정 저장 실패:', error);
    res.status(500).json({ ok: false, message: '알림 설정을 저장하지 못했습니다.' });
  }
});

async function getPredictionLeaderboard() {
  const histories = await db.collection('prediction_history').find({}).toArray();
  const counts = new Map();

  histories.forEach((history) => {
    const finalHomeScore = Number(history.finalHomeScore);
    const finalAwayScore = Number(history.finalAwayScore);
    const finalPick = finalHomeScore > finalAwayScore ? 'home' : finalHomeScore < finalAwayScore ? 'away' : 'draw';

    (history.votes || []).forEach((vote) => {
      const isOutcomeCorrect = vote.pick === finalPick;
      const isScoreCorrect = Number(vote.homeScore) === finalHomeScore
        && Number(vote.awayScore) === finalAwayScore;
      const current = counts.get(vote.username) || { outcomeCount: 0, scoreCount: 0, attemptCount: 0 };

      current.attemptCount += 1;
      if (isOutcomeCorrect) current.outcomeCount += 1;
      if (isScoreCorrect) current.scoreCount += 1;
      counts.set(vote.username, current);
    });
  });

  const leaderboard = Array.from(counts, ([username, count]) => ({
    username,
    ...count,
    points: count.outcomeCount + count.scoreCount * 3
  }))
    .filter((player) => player.outcomeCount > 0 || player.scoreCount > 0)
    .sort((first, second) => second.points - first.points
      || second.outcomeCount - first.outcomeCount
      || second.scoreCount - first.scoreCount
      || first.username.localeCompare(second.username, 'ko'));

  return leaderboard;
}

app.post('/prediction/setting', (req, res) => {
  upload.fields([
    { name: 'homeLogo', maxCount: 1 },
    { name: 'awayLogo', maxCount: 1 }
  ])(req, res, async (err) => {
    if (err) {
      return res.status(400).json({ ok: false, message: '팀 로고 업로드에 실패했습니다.' });
    }

    try {
      const { homeTeam, awayTeam, matchTime } = req.body || {};

      if (!homeTeam || !awayTeam || !matchTime) {
        return res.status(400).json({ ok: false, message: '홈팀, 원정팀, 경기 시작 시간을 모두 입력해주세요.' });
      }

      const matchTimeAt = parsePredictionMatchTime(matchTime);
      if (!matchTimeAt) {
        return res.status(400).json({ ok: false, message: '경기 시작 시간을 "2026년 10월 6일 20시 00분" 또는 "2026-10-06 20:00" 형식으로 입력해주세요.' });
      }

      const previousSetting = await db.collection('prediction_setting').findOne({}, { sort: { _id: -1 } });
      const homeLogo = req.files?.homeLogo?.[0]?.location || previousSetting?.homeLogo || '';
      const awayLogo = req.files?.awayLogo?.[0]?.location || previousSetting?.awayLogo || '';

      await db.collection('prediction_setting').insertOne({
        homeTeam: homeTeam.trim(),
        awayTeam: awayTeam.trim(),
        matchTime: matchTime.trim(),
        matchTimeAt,
        homeLogo,
        awayLogo,
        isOpen: matchTimeAt > new Date(),
        reminderSentAt: matchTimeAt.getTime() - Date.now() <= PREDICTION_REMINDER_MINUTES * 60 * 1000 ? new Date() : null,
        finalHomeScore: null,
        finalAwayScore: null,
        finalizedAt: null,
        updatedAt: new Date()
      });

      await db.collection('prediction_votes').deleteMany({});
      schedulePredictionCron({ matchTimeAt });
      logActivity(req.user.username, '승부예측 경기 설정 저장', `- ${homeTeam} vs ${awayTeam} (${matchTime})`);
      sendDiscordNotification(`새로운 승부예측이 등록되었습니다.\n${homeTeam.trim()} vs ${awayTeam.trim()}\n경기 시간: ${matchTime.trim()}`);
      res.json({ ok: true });
    } catch (error) {
      reportDeveloperError(error, req);
      console.error(error);
      res.status(500).json({ ok: false, message: '승부예측 설정 저장에 실패했습니다.' });
    }
  });
});

app.get('/prediction', (req, res, next) => {
  if (req.isAuthenticated()) {
    return next();
  }

  req.session.returnTo = req.originalUrl;
  res.render('login', { Needlogin_Message: '로그인이 필요합니다.', send_url: req.session.returnTo });
}, async (req, res) => {
  const prediction = await getCurrentPrediction();
  const votes = await db.collection('prediction_votes').find({}).sort({ createdAt: -1 }).toArray();
  const storedHistory = await db.collection('prediction_history').find({}).sort({ archivedAt: -1 }).limit(20).toArray();
  const predictionHistory = storedHistory.map((history) => {
    const finalHomeScore = Number(history.finalHomeScore);
    const finalAwayScore = Number(history.finalAwayScore);
    const finalPick = finalHomeScore > finalAwayScore ? 'home' : finalHomeScore < finalAwayScore ? 'away' : 'draw';
    return {
      ...history,
      votes: (history.votes || []).map((vote) => ({
        ...vote,
        isOutcomeCorrect: vote.pick === finalPick,
        isCorrect: Number(vote.homeScore) === finalHomeScore && Number(vote.awayScore) === finalAwayScore
      }))
    };
  });
  res.render('prediction.ejs', { prediction: prediction || null, votes: votes || [], predictionHistory });
});

app.post('/prediction/toggle', async (req, res) => {
  const prediction = await db.collection('prediction_setting').findOne({}, { sort: { _id: -1 } });
  if (!prediction) {
    return res.status(404).json({ ok: false, message: '먼저 승부예측 경기를 등록해주세요.' });
  }

  const isOpen = req.body.isOpen === true || req.body.isOpen === 'true';
  // 경기 시간이 지난 뒤 직접 다시 열면 자동 마감을 건너뛰고, 다시 닫으면 원래대로 돌아감
  const autoCloseSkipped = isOpen && isPredictionPastDeadline({ ...prediction, autoCloseSkipped: false });
  await db.collection('prediction_setting').updateOne(
    { _id: prediction._id },
    { $set: { isOpen, autoCloseSkipped, updatedAt: new Date() } }
  );
  logActivity(req.user.username, isOpen ? '승부예측 재개' : '승부예측 마감');
  if (!isOpen && prediction.isOpen !== false) {
    disablePredictionCron();
    await notifyPredictionClosed(prediction);
  }
  if (isOpen && !autoCloseSkipped) schedulePredictionCron(prediction);
  res.json({ ok: true, isOpen });
});

app.post('/prediction/result', async (req, res) => {
  const prediction = await db.collection('prediction_setting').findOne({}, { sort: { _id: -1 } });
  if (!prediction) {
    return res.status(404).json({ ok: false, message: '먼저 승부예측 경기를 등록해주세요.' });
  }

  const finalHomeScore = Number(req.body.finalHomeScore);
  const finalAwayScore = Number(req.body.finalAwayScore);
  if (!Number.isInteger(finalHomeScore) || !Number.isInteger(finalAwayScore) || finalHomeScore < 0 || finalAwayScore < 0) {
    return res.status(400).json({ ok: false, message: '최종 결과 스코어를 올바르게 입력해주세요.' });
  }

  const votes = await db.collection('prediction_votes').find({ settingId: String(prediction._id) }).toArray();
  const evaluatedVotes = votes.map((vote) => ({
    ...vote,
    isCorrect: Number(vote.homeScore) === finalHomeScore && Number(vote.awayScore) === finalAwayScore
  }));
  const archivedAt = new Date();
  await db.collection('prediction_history').updateOne(
    { settingId: String(prediction._id) },
    {
      $set: {
        settingId: String(prediction._id),
        homeTeam: prediction.homeTeam,
        awayTeam: prediction.awayTeam,
        homeLogo: prediction.homeLogo || '',
        awayLogo: prediction.awayLogo || '',
        matchTime: prediction.matchTime,
        finalHomeScore,
        finalAwayScore,
        votes: evaluatedVotes,
        archivedAt
      }
    },
    { upsert: true }
  );

  await db.collection('prediction_setting').updateOne(
    { _id: prediction._id },
    { $set: { finalHomeScore, finalAwayScore, isOpen: false, finalizedAt: archivedAt, updatedAt: archivedAt } }
  );
  logActivity(req.user.username, '승부예측 최종 결과 저장', `- ${prediction.homeTeam} ${finalHomeScore}:${finalAwayScore} ${prediction.awayTeam}`);

  disablePredictionCron();
  const finalPick = finalHomeScore > finalAwayScore ? 'home' : finalHomeScore < finalAwayScore ? 'away' : 'draw';
  const exactWinners = evaluatedVotes.filter((vote) => vote.isCorrect).map((vote) => vote.username).filter(Boolean);
  const outcomeHitCount = evaluatedVotes.filter((vote) => vote.pick === finalPick).length;
  const resultTitle = `[${prediction.homeTeam} vs ${prediction.awayTeam}] ${prediction.finalizedAt ? '승부예측 최종 결과가 수정되었습니다.' : '승부예측 최종 결과가 발표되었습니다.'}`;
  sendDiscordNotification(
    [
      resultTitle,
      `${prediction.homeTeam} ${finalHomeScore} : ${finalAwayScore} ${prediction.awayTeam}`,
      `스코어 적중: ${exactWinners.length ? exactWinners.join(', ') : '없음'}`,
      `승무패 적중: ${outcomeHitCount}명 / 참여 ${evaluatedVotes.length}명`
    ].join('\n'),
    { url: '/prediction' }
  );
  res.json({ ok: true, message: '최종 결과가 저장되고 예측이 마감되었습니다.' });
});

app.post('/prediction/history/delete-one', async (req, res) => {
  try {
    const { settingId } = req.body || {};
    if (!settingId) {
      return res.status(400).json({ ok: false, message: '삭제할 예측 이력을 선택해주세요.' });
    }

    const result = await db.collection('prediction_history').deleteOne({ settingId: String(settingId) });
    if (result.deletedCount === 0) {
      return res.status(404).json({ ok: false, message: '예측 이력을 찾을 수 없습니다.' });
    }

    logActivity(req.user.username, '승부예측 이력 개별 삭제', `- ${settingId}`);
    res.json({ ok: true, message: '선택한 승부예측 이력을 삭제했습니다.' });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error(error);
    res.status(500).json({ ok: false, message: '승부예측 이력 삭제에 실패했습니다.' });
  }
});

app.post('/prediction/submit', async (req, res) => {
  if (!req.user) {
    return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });
  }

  const prediction = await getCurrentPrediction();
  if (!prediction) {
    return res.status(404).json({ ok: false, message: '현재 진행 중인 승부예측이 없습니다.' });
  }
  if (prediction.isOpen === false) {
    return res.status(403).json({
      ok: false,
      message: prediction.autoClosedAt ? '경기 시작 시간이 지나 승부예측이 마감되었습니다.' : '현재 승부예측은 마감되었습니다.'
    });
  }

  const homeScore = Number(req.body.homeScore);
  const awayScore = Number(req.body.awayScore);

  if (!Number.isInteger(homeScore) || !Number.isInteger(awayScore) || homeScore < 0 || awayScore < 0) {
    return res.status(400).json({ ok: false, message: '홈팀과 원정팀의 점수를 올바르게 입력해주세요.' });
  }

  const pick = homeScore > awayScore ? 'home' : homeScore < awayScore ? 'away' : 'draw';

  await db.collection('prediction_votes').updateOne(
    { username: req.user.username },
    {
      $set: {
        username: req.user.username,
        homeScore,
        awayScore,
        pick,
        settingId: String(prediction._id),
        createdAt: new Date()
      }
    },
    { upsert: true }
  );

  logActivity(req.user.username, '승부예측 참여', `- ${prediction.homeTeam} ${homeScore}:${awayScore} ${prediction.awayTeam} / ${pick}`);
  res.json({ ok: true, message: '예측이 저장되었습니다.' });
});


app.get('/mvp', async (req, res) => {
  // MVP 추가
  let result = await db.collection('mvp').insertOne({
    mvp: req.query.val,
    month: req.query.month,
    day: req.query.day,
    mvp_name: req.query.MVP_Name
  });

  let query = { month: req.query.month, day: req.query.day };

  let updateResult = await db.collection('result').updateOne(query, { $set: { mvp_name: req.query.MVP_Name } });

  logActivity(req.user.username, 'MVP 선정', `- MVP: ${req.query.MVP_Name} (${req.query.month}.${req.query.day})`);

  if (updateResult.modifiedCount === 1) {
    console.log("Result collection 업데이트 성공");
  } else {
    console.log("업데이트된 문서가 없습니다.");
  }

  res.redirect('/');
});

// TODO1
app.post('/mvpboard', async (req, res) => {
  const timeZone = 'Asia/Seoul';
  const now = new Date();
  const savedTime = now.toLocaleString('ko-KR', { timeZone });
  const savedUsername = req.user.username;

  const member_score = req.body;

  await db.collection('mvpboard').insertOne({
    member_score,
    savedTime,
    savedUsername
  });

  logActivity(savedUsername, 'MVP Board 점수 저장', `- 총 ${Object.keys(member_score).length}명 점수 업데이트`);
  res.json({ ok: true });
});

app.post('/match-plan', async (req, res) => {

  let previousAddress = req.body.planaddress;

  if (!previousAddress) {
    let lastRecord = await db.collection('matchplan').findOne({}, { sort: { _id: -1 } });
    if (lastRecord) {
      previousAddress = lastRecord.address;
    }
  }

  await db.collection('matchplan').insertOne({
    year: req.body.planyear,
    month: req.body.planmonth,
    date: req.body.plandate,
    day: req.body.planday,
    time: req.body.plantime,
    timeto: req.body.plantimeto,
    awayteam: req.body.planawayteam,
    place: req.body.planplace,
    address: previousAddress
  });

  logActivity(req.user.username, '경기 일정 등록', `- ${req.body.planyear}.${req.body.planmonth}.${req.body.plandate} vs ${req.body.planawayteam}`);
  sendDiscordNotification(`이번 주 매치가 잡혔습니다. 홈페이지를 확인해주세요 !`);

  if (req.headers['content-type'] && req.headers['content-type'].includes('application/json')) {
    return res.json({ ok: true });
  }

  res.redirect('/');
})

app.post('/match-plan/latest', async (req, res) => {
  const latestMatchPlan = await db.collection('matchplan').findOne({}, { sort: { _id: -1 } });

  if (!latestMatchPlan) {
    return res.status(404).json({ ok: false, message: '수정할 매치 일정이 없습니다.' });
  }

  const updatedFields = {
    year: req.body.planyear,
    month: req.body.planmonth,
    date: req.body.plandate,
    day: req.body.planday,
    time: req.body.plantime,
    timeto: req.body.plantimeto,
    awayteam: req.body.planawayteam,
    place: req.body.planplace,
    address: req.body.planaddress || latestMatchPlan.address
  };

  await db.collection('matchplan').updateOne({ _id: latestMatchPlan._id }, { $set: updatedFields });
  logActivity(req.user.username, '최근 경기 일정 수정', `- ${updatedFields.year}.${updatedFields.month}.${updatedFields.date} vs ${updatedFields.awayteam}`);
  res.json({ ok: true });
});

app.post('/result', async (req, res) => {
  const data = req.body || {};
  const homescore = data.homescore;
  const awayscore = data.awayscore;

  if (!data.year || !data.month || !data.day || !data.awayname) {
    return res.status(400).json({ ok: false, message: '필수 경기 결과 값이 누락되었습니다.' });
  }

  await db.collection('result').insertOne({
    year: data.year,
    month: data.month,
    day: data.day,
    day2: data.day2,
    time: data.time,
    place: data.place,
    homescore: String(homescore),
    awayscore: String(awayscore),
    awayname: data.awayname,
    resultlogo: data.resultlogo,
    home_resultlogo: data.home_resultlogo,
    mvp_name: '미정'
  });

  logActivity(req.user.username, '경기 결과 등록', `- ${data.year}.${data.month}.${data.day} (오골 ${homescore} : ${awayscore} ${data.awayname})`);
  sendDiscordNotification(`지난 매치 결과가 등록되었습니다. \n오늘도골대FC ${homescore} : ${awayscore} ${data.awayname}`);
  res.json({ ok: true });
});

app.get('/result', async (req, res) => {
  let result = db.collection('result').insertOne({
    year: req.query.year,
    month: req.query.month,
    day: req.query.day,
    day2: req.query.day2,
    time: req.query.time,
    place: req.query.place,
    homescore: req.query.homescore,
    awayscore: req.query.awayscore,
    awayname: req.query.awayname,
    resultlogo: req.query.resultlogo,
    home_resultlogo: req.query.home_resultlogo,
    mvp_name: '미정'
  })
  logActivity(req.user.username, '경기 결과 등록', `- ${req.query.year}.${req.query.month}.${req.query.day} (오골 ${req.query.homescore} : ${req.query.awayscore} ${req.query.awayname})`);
  sendDiscordNotification(`지난 매치 결과가 등록되었습니다. \n오늘도골대FC ${req.query.homescore} : ${req.query.awayscore} ${req.query.awayname}`);
  res.redirect('/match-result')
})

app.post('/result/latest', async (req, res) => {
  const latestResult = await db.collection('result').findOne({}, { sort: { _id: -1 } });

  if (!latestResult) {
    return res.status(404).json({ ok: false, message: '수정할 경기 결과가 없습니다.' });
  }

  const updatedFields = {
    year: req.body.year,
    month: req.body.month,
    day: req.body.day,
    day2: req.body.day2,
    time: req.body.time,
    place: req.body.place,
    homescore: String(req.body.homescore),
    awayscore: String(req.body.awayscore),
    awayname: req.body.awayname,
    resultlogo: req.body.resultlogo,
    home_resultlogo: req.body.home_resultlogo
  };

  await db.collection('result').updateOne({ _id: latestResult._id }, { $set: updatedFields });
  logActivity(req.user.username, '최근 경기 결과 수정', `- ${updatedFields.year}.${updatedFields.month}.${updatedFields.day} (오골 ${updatedFields.homescore} : ${updatedFields.awayscore} ${updatedFields.awayname})`);
  res.json({ ok: true });
});

app.get('/match-result-delete/:id', async (req, res) => {
  let result = await db.collection('result').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('back')
})



passport.use(new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
  let result = await db.collection('user').findOne({ userID: 입력한아이디, isWithdrawn: { $ne: true } })
  if (!result) {
    return cb(null, false, { message: '아이디잘못침' })
  }


  if (await bcrypt.compare(입력한비번, result.password)) {
    return cb(null, result)
  } else {
    return cb(null, false, { message: '비번잘못침' });
  }
}))

// passport.authenticate('local')() 가 실행될 때 마다 아래 코드도 같이 실행됨 ( 세선만드는 코드 )

passport.serializeUser((user, done) => {
  console.log(user.username + '님이 로그인하였습니다.');
  process.nextTick(() => {
    done(null, { id: user._id, userID: user.userID })
  })
})

passport.deserializeUser(async (user, done) => {
  try {
    let result = await db.collection('user').findOne({ _id: new ObjectId(user.id), isWithdrawn: { $ne: true } });

    // Check if result exists before attempting to delete password
    if (result) {
      delete result.password;
      const timeZone = 'Asia/Seoul';
      let today = new Date(new Date().toLocaleDateString('ko-KR', { timeZone }));
      let recentLogin = result.recent_login;
      if (recentLogin != today.getDate()) {
        await db.collection('user').updateOne(
          { _id: new ObjectId(user.id) },
          { $set: { shooting_count: 20 } }
        );
      }
      await db.collection('user').updateOne(
        { _id: new ObjectId(user.id) },
        { $set: { recent_login: today.getDate() } }
      );

    }


    process.nextTick(() => {
      done(null, result);
    });
  } catch (error) {
    // Handle any errors that might occur during database operation
    done(error);
  }
});


exports.isLoggedIn = (req, res, next) => {
  if (req.isAuthenticated()) {
    next();
  } else {
    req.session.returnTo = req.originalUrl;
    var send_url = req.session.returnTo;
    res.render('login', { Needlogin_Message: '로그인이 필요합니다.', send_url });
  }
};

exports.isNotLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    next();
  } else {
    const message = encodeURIComponent('로그인한 상태입니다.');
    res.redirect('/');
  }
};


app.get('/login', exports.isNotLoggedIn, async (req, res, next) => {
  var send_url = '/'
  res.render('login', {send_url});
});

app.post('/login', async (req, res, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) {
      reportDeveloperError(error, req);
      return res.status(500).json({ success: false, message: '서버 에러' });
    }
    if (!user) return res.status(401).json({ success: false, message: info.message });

    req.logIn(user, (err) => {
      if (err) return next(err);
      delete req.session.returnTo;
      return res.json({ success: true });
    });

  })(req, res, next);
});



app.get('/logout', (req, res, next) => {
  req.logOut(err => {
    if (err) {
      return next(err);
    } else {
      console.log('로그아웃됨.');
      res.redirect('/');
    }
  });
});


app.get('/register', async (req, res) => {

  res.render('register.ejs')
})

app.post('/register', async (req, res) => {
  const timeZone = 'Asia/Seoul';
  let Time = new Date().toLocaleString('ko-KR', { timeZone });
  let 해시 = await bcrypt.hash(req.body.password, 10);
  let shooting_count = 20;
  var send_url = '/'

  if (req.body.memberCode == 'hdg0822') {
    await db.collection('user').insertOne({
      userID: req.body.userID,
      username: req.body.username,
      password: 해시,
      time: Time,
      shooting_count: shooting_count
    })
    res.render('login', { Register_Message: '회원가입이 완료되었습니다.', send_url });
  }
  else {
    res.render('register', { Member_Message: '멤버코드가 일치하지 않습니다.' });
  }

})


app.get('/notice', async (req, res) => {
  let result = await db.collection('notice').find().sort({ _id: -1 }).toArray();

  res.render('notice.ejs', { 글목록: result });
});


app.get('/notice/:number', async (req, res) => {
  // let result = await db.collection('notice').find().sort({ _id: -1 }).skip((req.params.number - 1) * 10).limit(10).toArray()
  let result = await db.collection('notice').find().sort({ _id: -1 }).skip((req.params.number - 1) * 10).limit(10).toArray();
  let result2 = await db.collection('notice').find().sort({ _id: -1 }).toArray();
  let result3 = await db.collection('update-note').find().sort({ _id: -1 }).toArray();


  let commentCounts = [];
  for (let i = 0; i < result.length; i++) {
    let commentCount = await db.collection('comment').countDocuments({ parentId: result[i]._id });
    commentCounts.push(commentCount);
  }

  res.render('notice.ejs', { 글목록: result, 글전체: result2, 업데이트글제목: result3, 댓글개수: commentCounts })
})


app.get('/notice-search', async (req, res) => {
  let result = await db.collection('notice')
    .find({
      $or: [
        { title: { $regex: req.query.search } },
        { content: { $regex: req.query.search } }
      ]
    }).toArray()

  res.render('notice-search.ejs', { 글목록: result })
})

app.get('/management/notice-post', async (req, res) => {

  res.render('notice-post.ejs');
});


app.post('/notice-post', async (req, res) => {

  const timeZone = 'Asia/Seoul';

  let Today = new Date().toLocaleDateString('ko-KR', { timeZone });
  let Time = new Date().toLocaleString('ko-KR', { timeZone });
  upload.array('img1', 5)(req, res, async (err) => {
    if (err) return res.send('업로드에러')
    try {
      if (req.body.title == '') {
        res.send('제목입력안했음')
      } else {
        const imageArray = req.files.length > 0 ? req.files.map(file => ({ filename: file.filename, location: file.location })) : [];

        await db.collection('notice').insertOne(
          {
            today: Today,
            time: Time,
            title: req.body.title,
            content: req.body.content,
            img: imageArray,
            user: req.user._id,
            username: req.user.username
          }
        )
        logActivity(req.user.username, '공지사항 작성', `- 제목: ${req.body.title} (이미지: ${imageArray.length}개)`);
        sendDiscordNotification(`공지가 등록되었습니다.[${req.body.title}]`);
        res.redirect('/notice/1')
      }
    } catch (e) {
      reportDeveloperError(e, req);
      console.log(e)
      res.status(500).render('error.ejs')
    }
  })

})

app.get('/notice/notice-detail/:id', this.isLoggedIn, async (req, res, next) => {
  let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
  let comment = await db.collection('comment').find({ parentId: new ObjectId(req.params.id) }).toArray()

  res.render('notice-detail.ejs', { 글: postID, 댓글: comment })

})

app.get('/notice-edit/:id', async (req, res) => {
  let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })

  res.render('notice-edit.ejs', { 글: postID })
})

app.put('/notice-edit', async (req, res) => {

  let result = await db.collection('notice').updateOne({ _id: new ObjectId(req.body.id) },
    {
      $set: {
        title: req.body.title,
        content: req.body.content
      }
    })

  logActivity(req.user.username, '공지사항 수정', `- ID: ${req.body.id}`);
  res.redirect('/notice/notice-detail/' + req.body.id)

})

app.get('/notice-delete/:id', async (req, res) => {
  let result = await db.collection('notice').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  logActivity(req.user.username, '공지사항 삭제', `- ID: ${req.params.id}`);
  res.redirect('/notice/1')
})

app.post('/comment', async (req, res) => {

  // if (!req.body.content) {
  //   return res.status(400).json({ error: '댓글을 입력하세요.' });
  // } else if (req.body.content) {
  await db.collection('comment').insertOne({
    content: req.body.content,
    writerId: new ObjectId(req.user._id),
    writer: req.user.username,
    parentId: new ObjectId(req.body.parentId)
  })
  sendDiscordNotification(`[${req.user?.username || '익명'}] 님이 공지 글 댓글을 달았습니다.`);
  res.redirect('back')
}



  // }
)


app.get('/notice-comment-delete/:id', async (req, res) => {
  let result = await db.collection('comment').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('back')
})

app.get('/update-note', async (req, res) => {
  let result = await db.collection('update-note').find().sort({ _id: -1 }).toArray();

  res.render('update-note.ejs', { 업데이트글목록: result });
});


app.get('/update-note-search', async (req, res) => {
  let result = await db.collection('update-note')
    .find({
      $or: [
        { title: { $regex: req.query.search } },
        { content: { $regex: req.query.search } }
      ]
    }).toArray()

  res.render('update-note-search.ejs', { 업데이트글목록: result })
})

app.get('/management/update-note-post', async (req, res) => {

  res.render('update-note-post.ejs');
});


app.post('/update-note-post', async (req, res) => {

  const timeZone = 'Asia/Seoul';

  let Today = new Date().toLocaleDateString('ko-KR', { timeZone });
  let Time = new Date().toLocaleString('ko-KR', { timeZone });
  upload.array('img1', 5)(req, res, async (err) => {
    if (err) return res.send('업로드에러')
    try {
      if (req.body.title == '') {
        res.send('제목입력안했음')
      } else {
        const imageArray = req.files.length > 0 ? req.files.map(file => ({ filename: file.filename, location: file.location })) : [];

        await db.collection('update-note').insertOne(
          {
            today: Today,
            time: Time,
            title: req.body.title,
            content: req.body.content,
            img: imageArray,
            user: req.user._id,
            username: req.user.username
          }
        )
        logActivity(req.user.username, '업데이트 공지 작성', `- 제목: ${req.body.title} (이미지: ${imageArray.length}개)`);
        res.redirect('/update-note')
      }
    } catch (e) {
      reportDeveloperError(e, req);
      console.log(e)
      res.status(500).render('error.ejs')
    }
  })

})

app.get('/update-note-detail/:id', async (req, res, next) => {
  let postID = await db.collection('update-note').findOne({ _id: new ObjectId(req.params.id) })

  res.render('update-note-detail.ejs', { 글: postID })

})

app.get('/update-note-edit/:id', async (req, res) => {
  let postID = await db.collection('update-note').findOne({ _id: new ObjectId(req.params.id) })

  res.render('update-note-edit.ejs', { 글: postID })
})

app.put('/update-note-edit', async (req, res) => {

  let result = await db.collection('update-note').updateOne({ _id: new ObjectId(req.body.id) },
    {
      $set: {
        title: req.body.title,
        content: req.body.content
      }
    })

  res.redirect('/update-note-detail/' + req.body.id)

})

app.get('/update-note-delete/:id', async (req, res) => {
  let result = await db.collection('update-note').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('/update-note')
})

app.get('/update-note-edit/:id', async (req, res) => {
  let postID = await db.collection('update-note').findOne({ _id: new ObjectId(req.params.id) })

  res.render('update-note-edit.ejs', { 글: postID })
})

app.put('/update-note-edit', async (req, res) => {

  let result = await db.collection('update-note').updateOne({ _id: new ObjectId(req.body.id) },
    {
      $set: {
        title: req.body.title,
        content: req.body.content
      }
    })

  res.redirect('/update-note/update-note-detail/' + req.body.id)

})



app.get('/introduce', async (req, res) => {

  res.render('introduce.ejs');
});


app.post('/statinfo', async (req, res) => {
  const playerInfo = req.body.playerInfo;
  let userID = null;

  // req.user 객체가 정의되어 있는지 확인 후, userID 설정
  if (req.user && req.user.userID) {
    userID = req.user.userID;
  } else {
    userID = 0; // req.user.userID가 없는 경우 0을 사용
  }

  req.session.playerInfo = playerInfo;

  try {
    // user 컬렉션에서 특정 사용자의 프로필 정보 조회
    let result = await db.collection('user').aggregate([
      {
        $match: {
          userID: playerInfo,
          isWithdrawn: { $ne: true }
        }
      },
      {
        $project: {
          profileImage: 1,
          backnumber: 1,
          username: 1
        }
      }
    ]).toArray();

    // user 데이터가 존재하는 경우
    if (result.length > 0) {
      // stats 컬렉션에서 특정 조건에 맞는 데이터 조회
      const stats = await db.collection('stats').find({ userID: userID, 'stat.to_userID': playerInfo}).toArray();
      const extractedStats = stats.map(stat => stat.stat);

      // stats_result 컬렉션에서 특정 조건에 맞는 데이터 조회
      const statsResult = await db.collection('stats_result').find({ 'to_userID': playerInfo }).toArray();
      const extractedStatsResult = statsResult.map(stat => stat);

      // 클라이언트에게 프로필 정보와 통계 정보 함께 응답
      res.json({
        profileImage: result[0].profileImage,
        backnumber: result[0].backnumber,
        username: result[0].username,
        stats: extractedStats, // stats 데이터 추가
        statsResult: extractedStatsResult // stats_result 데이터 추가
      });
    } else {
      console.log('해당하는 데이터가 없습니다.');
      res.status(404).json({ error: '데이터를 찾을 수 없습니다.' });
    }
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('데이터 조회 중 오류 발생:', error.message);
    res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
  }
});


app.post('/statinfo', async (req, res) => {
  const playerInfo = req.body.playerInfo;
  let userID = null;

  if (req.user && req.user.userID) {
    userID = req.user.userID;
  } else {
    userID = 0;
  }

  req.session.playerInfo = playerInfo;

  try {
    let result = await db.collection('user').aggregate([
      {
        $match: {
          userID: playerInfo,
          isWithdrawn: { $ne: true }
        }
      },
      {
        $project: {
          profileImage: 1,
          backnumber: 1,
          username: 1
        }
      }
    ]).toArray();

    if (result.length > 0) {
      const stats = await db.collection('stats').find({ userID: userID, 'stat.to_userID': playerInfo }).toArray();
      const extractedStats = stats.map(stat => stat.stat);

      const statsResult = await db.collection('stats_result').find({ 'to_userID': playerInfo }).toArray();
      const extractedStatsResult = statsResult.map(stat => stat);

      res.json({
        profileImage: result[0].profileImage,
        backnumber: result[0].backnumber,
        username: result[0].username,
        stats: extractedStats,
        statsResult: extractedStatsResult
      });
    } else {
      console.log('해당하는 데이터가 없습니다.');
      res.status(404).json({ error: '데이터를 찾을 수 없습니다.' });
    }
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('데이터 조회 중 오류 발생:', error.message);
    res.status(500).json({ error: '데이터 조회 중 오류가 발생했습니다.' });
  }
});


app.get('/savestat', async (req, res) => {
  const playerInfo = req.session.playerInfo;

  if (!playerInfo) {
    return res.status(400).json({ error: 'playerInfo가 없습니다.' });
  }

  let stats = {
    userID: req.user.userID,
    stat: {
      to_userID: playerInfo,
      stat1: parseFloat(req.query.stat1),
      stat2: parseFloat(req.query.stat2),
      stat3: parseFloat(req.query.stat3),
      stat4: parseFloat(req.query.stat4),
      stat5: parseFloat(req.query.stat5),
      stat6: parseFloat(req.query.stat6),
      stat7: parseFloat(req.query.stat7),
      stat8: parseFloat(req.query.stat8),
      stat9: parseFloat(req.query.stat9),
      stat10: parseFloat(req.query.stat10),
      stat11: parseFloat(req.query.stat11),
      stat12: parseFloat(req.query.stat12),
      stat13: parseFloat(req.query.stat13),
      stat14: parseFloat(req.query.stat14),
      stat15: parseFloat(req.query.stat15),
      stat16: parseFloat(req.query.stat16),
      stat17: parseFloat(req.query.stat17),
      stat18: parseFloat(req.query.stat18)
    }
  };

  try {
    await db.collection('stats').updateOne(
      { userID: req.user.userID, "stat.to_userID": playerInfo },
      { $set: stats },
      { upsert: true }
    );

    await updateStatsResult(playerInfo);

    res.redirect('/introduce');
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('데이터 저장 중 오류 발생:', error.message);
    res.status(500).json({ error: '데이터 저장 중 오류가 발생했습니다.' });
  }
});

async function updateStatsResult(playerInfo) {
  const pipeline = [
    {
      $match: {
        "stat.to_userID": playerInfo
      }
    },
    {
      $group: {
        _id: "$stat.to_userID",
        avg_stat1: { $avg: "$stat.stat1" },
        avg_stat2: { $avg: "$stat.stat2" },
        avg_stat3: { $avg: "$stat.stat3" },
        avg_stat4: { $avg: "$stat.stat4" },
        avg_stat5: { $avg: "$stat.stat5" },
        avg_stat6: { $avg: "$stat.stat6" },
        avg_stat7: { $avg: "$stat.stat7" },
        avg_stat8: { $avg: "$stat.stat8" },
        avg_stat9: { $avg: "$stat.stat9" },
        avg_stat10: { $avg: "$stat.stat10" },
        avg_stat11: { $avg: "$stat.stat11" },
        avg_stat12: { $avg: "$stat.stat12" },
        avg_stat13: { $avg: "$stat.stat13" },
        avg_stat14: { $avg: "$stat.stat14" },
        avg_stat15: { $avg: "$stat.stat15" },
        avg_stat16: { $avg: "$stat.stat16" },
        avg_stat17: { $avg: "$stat.stat17" },
        avg_stat18: { $avg: "$stat.stat18" },
        kick_avg: { $avg: { $avg: ["$stat.stat1", "$stat.stat3", "$stat.stat5"] } },
        physical_avg: { $avg: { $avg: ["$stat.stat2", "$stat.stat4", "$stat.stat6", "$stat.stat7"] } },
        dribble_avg: { $avg: { $avg: ["$stat.stat8", "$stat.stat10", "$stat.stat12", "$stat.stat14"] } },
        intelligence_avg: { $avg: { $avg: ["$stat.stat9", "$stat.stat11", "$stat.stat13", "$stat.stat15"] } },
        deffense_avg: { $avg: { $avg: ["$stat.stat16", "$stat.stat17", "$stat.stat18"] } }
      }
    },
    {
      $project: {
        _id: 0,
        to_userID: "$_id",
        avg_stat1: { $toInt: { $round: ["$avg_stat1", 0] }},
        avg_stat2: { $toInt: { $round: ["$avg_stat2", 0] }},
        avg_stat3: { $toInt: { $round: ["$avg_stat3", 0] }},
        avg_stat4: { $toInt: { $round: ["$avg_stat4", 0] }},
        avg_stat5: { $toInt: { $round: ["$avg_stat5", 0] }},
        avg_stat6: { $toInt: { $round: ["$avg_stat6", 0] }},
        avg_stat7: { $toInt: { $round: ["$avg_stat7", 0] }},
        avg_stat8: { $toInt: { $round: ["$avg_stat8", 0] }},
        avg_stat9: { $toInt: { $round: ["$avg_stat9", 0] }},
        avg_stat10: { $toInt: { $round: ["$avg_stat10", 0] }},
        avg_stat11: { $toInt: { $round: ["$avg_stat11", 0] }},
        avg_stat12: { $toInt: { $round: ["$avg_stat12", 0] }},
        avg_stat13: { $toInt: { $round: ["$avg_stat13", 0] }},
        avg_stat14: { $toInt: { $round: ["$avg_stat14", 0] }},
        avg_stat15: { $toInt: { $round: ["$avg_stat15", 0] }},
        avg_stat16: { $toInt: { $round: ["$avg_stat16", 0] }},
        avg_stat17: { $toInt: { $round: ["$avg_stat17", 0] }},
        avg_stat18: { $toInt: { $round: ["$avg_stat18", 0] }},
        kick_avg: { $toInt: { $round: ["$kick_avg", 0] }},
        physical_avg: { $toInt: { $round: ["$physical_avg", 0] }},
        dribble_avg: { $toInt: { $round: ["$dribble_avg", 0] }},
        intelligence_avg: { $toInt: { $round: ["$intelligence_avg", 0] }},
        deffense_avg: { $toInt: { $round: ["$deffense_avg", 0] }}
      }
    }
  ];

  const result = await db.collection('stats').aggregate(pipeline).toArray();

  if (result.length > 0) {
    await db.collection('stats_result').updateOne(
      { to_userID: playerInfo },
      { $set: result[0] },
      { upsert: true }
    );
  }

  // 새로운 파이프라인으로 소수 첫째 자리까지 반올림한 평균 계산 및 저장
  const pipelinePure = [
    {
      $match: {
        "stat.to_userID": playerInfo
      }
    },
    {
      $group: {
        _id: "$stat.to_userID",
        avg_stat1: { $avg: "$stat.stat1" },
        avg_stat2: { $avg: "$stat.stat2" },
        avg_stat3: { $avg: "$stat.stat3" },
        avg_stat4: { $avg: "$stat.stat4" },
        avg_stat5: { $avg: "$stat.stat5" },
        avg_stat6: { $avg: "$stat.stat6" },
        avg_stat7: { $avg: "$stat.stat7" },
        avg_stat8: { $avg: "$stat.stat8" },
        avg_stat9: { $avg: "$stat.stat9" },
        avg_stat10: { $avg: "$stat.stat10" },
        avg_stat11: { $avg: "$stat.stat11" },
        avg_stat12: { $avg: "$stat.stat12" },
        avg_stat13: { $avg: "$stat.stat13" },
        avg_stat14: { $avg: "$stat.stat14" },
        avg_stat15: { $avg: "$stat.stat15" },
        avg_stat16: { $avg: "$stat.stat16" },
        avg_stat17: { $avg: "$stat.stat17" },
        avg_stat18: { $avg: "$stat.stat18" },
        kick_avg: { $avg: { $avg: ["$stat.stat1", "$stat.stat3", "$stat.stat5"] } },
        physical_avg: { $avg: { $avg: ["$stat.stat2", "$stat.stat4", "$stat.stat6", "$stat.stat7"] } },
        dribble_avg: { $avg: { $avg: ["$stat.stat8", "$stat.stat10", "$stat.stat12", "$stat.stat14"] } },
        intelligence_avg: { $avg: { $avg: ["$stat.stat9", "$stat.stat11", "$stat.stat13", "$stat.stat15"] } },
        deffense_avg: { $avg: { $avg: ["$stat.stat16", "$stat.stat17", "$stat.stat18"] } }
      }
    },
    {
      $project: {
        _id: 0,
        to_userID: "$_id",
        avg_stat1: { $round: ["$avg_stat1", 2] },
        avg_stat2: { $round: ["$avg_stat2", 2] },
        avg_stat3: { $round: ["$avg_stat3", 2] },
        avg_stat4: { $round: ["$avg_stat4", 2] },
        avg_stat5: { $round: ["$avg_stat5", 2] },
        avg_stat6: { $round: ["$avg_stat6", 2] },
        avg_stat7: { $round: ["$avg_stat7", 2] },
        avg_stat8: { $round: ["$avg_stat8", 2] },
        avg_stat9: { $round: ["$avg_stat9", 2] },
        avg_stat10: { $round: ["$avg_stat10", 2] },
        avg_stat11: { $round: ["$avg_stat11", 2] },
        avg_stat12: { $round: ["$avg_stat12", 2] },
        avg_stat13: { $round: ["$avg_stat13", 2] },
        avg_stat14: { $round: ["$avg_stat14", 2] },
        avg_stat15: { $round: ["$avg_stat15", 2] },
        avg_stat16: { $round: ["$avg_stat16", 2] },
        avg_stat17: { $round: ["$avg_stat17", 2] },
        avg_stat18: { $round: ["$avg_stat18", 2] },
        kick_avg: { $round: ["$kick_avg", 2] },
        physical_avg: { $round: ["$physical_avg", 2] },
        dribble_avg: { $round: ["$dribble_avg", 2] },
        intelligence_avg: { $round: ["$intelligence_avg", 2] },
        deffense_avg: { $round: ["$deffense_avg", 2] }
      }
    }
  ];

  const resultPure = await db.collection('stats').aggregate(pipelinePure).toArray();

  if (resultPure.length > 0) {
    await db.collection('stats_result_pure').updateOne(
      { to_userID: playerInfo },
      { $set: resultPure[0] },
      { upsert: true }
    );
  }
}



app.get('/ChrStat', async (req, res) => {
  try {
    let userID = req.query.userID;
    let chr = req.query.chr.split(','); // 쉼표로 구분된 문자열을 배열로 변환

    // stats_result 컬렉션에서 문서를 업데이트
    let result = await db.collection('stats_result').updateOne(
      { to_userID: userID }, // 필터: 해당 userID를 가진 문서를 찾음
      { $set: { chr: chr } }, // 업데이트: chr 필드를 새로운 값으로 설정
      { upsert: true } // 옵션: 문서가 존재하지 않으면 새로 삽입
    );

    logActivity(req.user.username, '선수 특성 부여', `- 대상: ${userID} (${chr.length}개 특성)`);
    res.redirect('back');
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('stats_result 업데이트 중 오류 발생:', error.message);
    res.status(500).render('error.ejs');
  }
});



app.get('/match-result', async (req, res) => {
  let result = await db.collection('result').find().sort({ _id: -1 }).toArray();
  res.render('match-result.ejs', { result: result });
});

app.get('/gamezone-shooting', this.isLoggedIn, async (req, res, next) => {
  const timeZone = 'Asia/Seoul';
  const today = new Date();
  const currentMonth = today.toLocaleString('ko-KR', { timeZone, month: '2-digit' });
  const currentYear = today.toLocaleString('ko-KR', { timeZone, year: 'numeric' });
  let yearMonth = `${currentYear}-${currentMonth}`;

  // 쿼리로 이전 달 보기 옵션 지원 (예: ?prev=1)
  const isPrev = req.query.prev === '1';
  if (isPrev) {
    const prevDate = new Date();
    prevDate.setMonth(prevDate.getMonth() - 1);
    const prevMonth = prevDate.toLocaleString('ko-KR', { timeZone, month: '2-digit' });
    const prevYear = prevDate.toLocaleString('ko-KR', { timeZone, year: 'numeric' });
    yearMonth = `${prevYear}-${prevMonth}`;
  }

  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;
  let ShootingScore = await db.collection('gamezone_shooting').find({ yearMonth: yearMonth }).sort({ top_score: -1 }).toArray();

  res.render('gamezone-shooting.ejs', { mvpboard: mvpboard, ShootingScore: ShootingScore, isPrev: isPrev, yearMonth: yearMonth });
});

app.post('/gamezone-shooting-extrachance', async (req, res) => {
  let username = req.user.username;
  let userShootingCount = req.body.userShootingCount;
  // console.log(userShootingCount)

  await db.collection('user').updateOne(
    { username: username },
    { $set: { shooting_count: userShootingCount } }
  );
  res.json({ success: true });
});

app.get('/gamezone-shooting-scoreboard-check', async (req, res) => {
  const timeZone = 'Asia/Seoul';
  const today = new Date();
  const currentMonth = today.toLocaleString('ko-KR', { timeZone, month: '2-digit' });
  const currentYear = today.toLocaleString('ko-KR', { timeZone, year: 'numeric' });
  const yearMonth = `${currentYear}-${currentMonth}`;

  let username = req.user.username;
  let existingUser = await db.collection('gamezone_shooting').findOne({ name: username, yearMonth: yearMonth });

  if (existingUser) {
    res.json({ top_score: existingUser.top_score });
  } else {
    res.json({ top_score: 0 });
  }
});


app.get('/gamezone-shooting-scoreboard', async (req, res) => {
  const timeZone = 'Asia/Seoul';
  const today = new Date();
  const currentMonth = today.toLocaleString('ko-KR', { timeZone, month: '2-digit' });
  const currentYear = today.toLocaleString('ko-KR', { timeZone, year: 'numeric' });
  const yearMonth = `${currentYear}-${currentMonth}`;

  let score = parseInt(req.query.score);
  let username = req.user.username;

  // Keep the best monthly score and use the update result to detect a new record.
  let result = await db.collection('gamezone_shooting').updateOne(
    { name: username, yearMonth: yearMonth },
    { $max: { top_score: score }, $set: { yearMonth: yearMonth } },
    { upsert: true }
  );
  const isPersonalRecord = Number.isInteger(score) && score > 0
    && (result.modifiedCount > 0 || result.upsertedCount > 0);

  // 업데이트 후 현재 월의 1등을 확인하여 조건(점수 >= 10 && 1등) 만족 시 알림 전송
  const topList = await db.collection('gamezone_shooting')
    .find({ yearMonth: yearMonth })
    .sort({ top_score: -1 })
    .limit(1)
    .toArray();

  if (topList && topList.length > 0) {
    const topEntry = topList[0];
    if (score >= 10 && topEntry.name === username && topEntry.top_score === score) {
      sendDiscordNotification(`[${username}] 님이 승부차기에서 ${score}점으로 1위를 기록했습니다.`);
    }
  }

  if (isPersonalRecord) {
    scheduleBackgroundTask(
      sendDeveloperDiscordMessage(`[승부차기 신기록]\n사용자: ${username}\n기록: ${score}점\n기준 월: ${yearMonth}`),
      'Shooting game record notification'
    );
  }

  logActivity(username, '승부차기 점수 저장', `- 점수: ${score}점 (${yearMonth})`);

  res.redirect('back');
});


app.post('/reset-shootinggame', async (req, res) => {
  const timeZone = 'Asia/Seoul';
  const today = new Date();
  const currentMonth = today.toLocaleString('ko-KR', { timeZone, month: '2-digit' });
  const currentYear = today.toLocaleString('ko-KR', { timeZone, year: 'numeric' });
  const yearMonth = `${currentYear}-${currentMonth}`;

  const collection = db.collection('gamezone_shooting');
  await collection.deleteMany({ yearMonth: yearMonth });
  logActivity(req.user.username, '승부차기 데이터 초기화', `- 삭제월: ${yearMonth}`);
  res.redirect('/')
})





app.get('/photo', this.isLoggedIn, async (req, res, next) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const perPage = 10;
    const skip = (page - 1) * perPage;
    
    // 전체 사진 개수 조회
    const totalPhotos = await db.collection('photo').countDocuments();
    const totalPages = Math.ceil(totalPhotos / perPage);
    
    // 현재 페이지의 사진 10개 로드
    let result = await db.collection('photo').aggregate([
      {
        $lookup: {
          from: 'photo-comment',
          localField: '_id',
          foreignField: 'parentId',
          as: 'comments'
        }
      },
      {
        $sort: {
          _id: -1
        }
      },
      {
        $skip: skip
      },
      {
        $limit: perPage
      }
    ]).toArray();
    
    res.render('photo.ejs', { 포토: result, currentPage: page, totalPages: totalPages });
  } catch (error) {
    console.error(error);
    next(error);
  }
});



app.get('/photo-post', async (req, res) => {

  res.render('photo-post.ejs');
});



app.post('/photo-post', async (req, res) => {

  const timeZone = 'Asia/Seoul';

  let Today = new Date().toLocaleDateString('ko-KR', { timeZone });
  let Time = new Date().toLocaleString('ko-KR', { timeZone });
  upload.array('img1', 10)(req, res, async (err) => {
    if (err) return res.send('업로드에러')
    try {
      if (req.body.title == '') {
        res.send('제목입력안했음')
      } else {
        const imageArray = req.files.length > 0 ? req.files.map(file => ({ filename: file.filename, location: file.location })) : [];

        await db.collection('photo').insertOne(
          {
            today: Today,
            time: Time,
            content: req.body.content,
            img: imageArray,
            user: req.user._id,
            username: req.user.username
          }
        )
        sendDiscordNotification(`[${req.user?.username || '익명'}] 님이 사진을 등록하였습니다.`);
        res.redirect('/photo')
      }
    } catch (e) {
      reportDeveloperError(e, req);
      console.log(e)
      res.status(500).render('error.ejs')
    }
  })

})

app.get('/photo-edit/:id', async (req, res) => {
  let photoID = await db.collection('photo').findOne({ _id: new ObjectId(req.params.id) })

  res.render('photo-edit.ejs', { 포토: photoID })
})

app.put('/photo-edit', async (req, res) => {

  let result = await db.collection('photo').updateOne({ _id: new ObjectId(req.body.id) },
    {
      $set: {
        content: req.body.content
      }
    })

  res.redirect('/photo')

})

app.get('/photo-delete/:id', async (req, res) => {
  const photoId = new ObjectId(req.params.id);
  await db.collection('photo-comment').deleteMany({ parentId: photoId });
  await db.collection('photo').deleteOne({ _id: photoId });
  res.redirect('/photo')
})

app.post('/photo-like/:id', async (req, res) => {
  const photoId = new ObjectId(req.params.id);
  const username = req.user.username;
  const photo = await db.collection('photo').findOne({ _id: photoId }, { projection: { likes: 1 } });

  if (!photo) {
    return res.status(404).json({ ok: false, message: '사진을 찾을 수 없습니다.' });
  }

  const likes = Array.isArray(photo.likes) ? photo.likes : [];
  const isLiked = likes.includes(username);
  const update = isLiked
    ? { $pull: { likes: username } }
    : { $addToSet: { likes: username } };

  await db.collection('photo').updateOne({ _id: photoId }, update);
  res.json({ ok: true, liked: !isLiked, likeCount: isLiked ? likes.length - 1 : likes.length + 1 });
});

app.post('/photo-comment', async (req, res) => {


  await db.collection('photo-comment').insertOne({
    content: req.body.content,
    writerId: new ObjectId(req.user._id),
    writer: req.user.username,
    parentId: new ObjectId(req.body.parentId)
  })
  sendDiscordNotification(`${req.user?.username || '익명'} 님이 사진에 댓글을 달았습니다. [${req.body.content}]`);
  res.redirect('back')
}
)

app.get('/photo-comment-delete/:id', async (req, res) => {
  let result = await db.collection('photo-comment').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('back')
})

app.get('/video', this.isLoggedIn, async (req, res) => {
  let URL3 = await db.collection('youtubeURL').find().sort({ _id: -1 }).limit(3).toArray();

  res.render('video.ejs', { URL3:URL3 });
});

app.get('/load-more-videos', this.isLoggedIn, async (req, res) => {
  try {
    // DB에서 추가적인 비디오 데이터를 가져옴
    const newVideos = await db.collection('youtubeURL').find().sort({ _id: -1 }).skip(3).toArray();
    res.json(newVideos); // JSON 형식으로 클라이언트에 응답
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('Error loading more videos:', error);
    res.status(500).json({ error: 'Failed to load more videos' });
  }
});


app.get('/UploadURL', async (req, res) => {
  let result = await db.collection('youtubeURL').insertOne({
    URL: req.query.URL
  })
  logActivity(req.user.username, 'YouTube 영상 업로드', `- 비디오 ID: ${req.query.URL}`);
  res.redirect('/video')
})

app.get('/video-delete/:id', async (req, res) => {
  let result = await db.collection('youtubeURL').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('/video')
})


// 사용자 정보를 제공하는 엔드포인트
app.get('/user', async (req, res) => {
  // 세션에서 유저 정보 가져오기 (여기서는 더미 데이터로 대체)
  const userData = {
    userId: req.user.userID
  };

  res.json(userData);
});

// 팀소개 탭 포메이션 기준 포지션. 회원이 직접 입력(user.position)하기 전까지 임시로 사용한다.
const MEMBER_POSITIONS = ['GOLEIRO', 'FIXO', 'ALA', 'PIVO'];
const TEAM_POSITION_BY_USER_ID = {
  tjrqjatn97: 'FIXO', saaq45: 'FIXO', bigstarhan33: 'FIXO',
  oyt001: 'ALA', cjfwls34: 'ALA', qkrwjd24568: 'ALA', rere4581: 'ALA', als123eotlr: 'ALA',
  sst266: 'ALA', chw7244: 'ALA', hsn972: 'ALA',
  taehoon9908: 'PIVO', yusjin96: 'PIVO',
  ks9071: 'GOLEIRO'
};

function getMemberPosition(user) {
  const position = String(user?.position || TEAM_POSITION_BY_USER_ID[user?.userID] || '').toUpperCase();
  return MEMBER_POSITIONS.includes(position) ? position : null;
}

// 회원 입력 정보(생일·키·몸무게)
const MEMBER_BODY_LIMIT = 300; // 키(cm)·몸무게(kg) 입력 상한

function getKoreanAge(birthDateKey, todayKey = getSeoulDateKey()) {
  const [birthYear, birthMonth, birthDay] = birthDateKey.split('-').map(Number);
  const [year, month, day] = todayKey.split('-').map(Number);
  let age = year - birthYear;
  if (month < birthMonth || (month === birthMonth && day < birthDay)) age -= 1;
  return age;
}

function isValidBirthDateKey(value, todayKey = getSeoulDateKey()) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const isRealDate = date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return isRealDate && value >= '1900-01-01' && value <= todayKey;
}

// 자연수(1 이상 정수)만 허용. 문자열 "181", 숫자 181 모두 받되 "181.5", "-1", "1e2"는 거절
function parseNaturalNumber(value) {
  const text = String(value ?? '').trim();
  if (!/^[1-9]\d*$/.test(text)) return null;
  const number = Number(text);
  return number <= MEMBER_BODY_LIMIT ? number : null;
}

function getMemberProfileInfo(user) {
  const birthDateKey = user?.birthDate instanceof Date ? getSeoulDateKey(user.birthDate) : String(user?.birthDate || '');
  const hasBirthDate = isValidBirthDateKey(birthDateKey);
  const heightCm = parseNaturalNumber(user?.heightCm);
  const weightKg = parseNaturalNumber(user?.weightKg);

  return {
    // 생년월일·키·몸무게가 모두 입력돼야 프로필 정보(포지션·특성 포함)를 보여준다
    isComplete: Boolean(hasBirthDate && heightCm && weightKg),
    position: getMemberPosition(user),
    birth: hasBirthDate ? { label: birthDateKey.replaceAll('-', '.'), age: getKoreanAge(birthDateKey) } : null,
    body: heightCm && weightKg ? `${heightCm}cm, ${weightKg}kg` : null,
    form: {
      birthDate: hasBirthDate ? birthDateKey : '',
      heightCm: heightCm || '',
      weightKg: weightKg || ''
    }
  };
}

// 선수 스탯창(stats_result.chr)에 등록된 특성 이미지. 빈 칸(none.png)은 제외한다.
function getMemberTraits(statsResult) {
  const urls = Array.isArray(statsResult?.chr) ? statsResult.chr : [];
  return urls
    .filter((url) => typeof url === 'string' && url.trim() && !/\/none\.png(\?|$)/i.test(url))
    .map((url) => {
      let name = '특성';
      try {
        name = decodeURIComponent(new URL(url).pathname.split('/').pop()).replace(/\.[a-z]+$/i, '');
      } catch (_error) { /* 이름을 못 읽으면 기본값 사용 */ }
      return { imageUrl: url, name };
    });
}

app.post('/mypage/profile-info', async (req, res) => {
  if (!req.user) return res.status(401).json({ ok: false, message: '로그인이 필요합니다.' });

  const todayKey = getSeoulDateKey();
  const birthDate = String(req.body?.birthDate || '').trim();
  const heightCm = parseNaturalNumber(req.body?.heightCm);
  const weightKg = parseNaturalNumber(req.body?.weightKg);

  if (!isValidBirthDateKey(birthDate, todayKey)) {
    return res.status(400).json({ ok: false, message: '생년월일을 올바르게 입력해주세요.' });
  }
  if (!heightCm || !weightKg) {
    return res.status(400).json({ ok: false, message: `키와 몸무게는 1~${MEMBER_BODY_LIMIT} 사이의 자연수로 입력해주세요.` });
  }

  try {
    await db.collection('user').updateOne(
      { _id: new ObjectId(req.user._id), isWithdrawn: { $ne: true } },
      { $set: { birthDate, heightCm, weightKg, profileInfoUpdatedAt: new Date() } }
    );
    logActivity(req.user.username, '회원정보 수정');
    res.json({ ok: true });
  } catch (error) {
    reportDeveloperError(error, req);
    console.error('회원정보 저장 실패:', error);
    res.status(500).json({ ok: false, message: '회원정보를 저장하지 못했습니다.' });
  }
});

app.get('/mypage/:userId', async (req, res) => {
  if (!req.user) return res.redirect('/login');

  const profileOwner = await db.collection('user').findOne(
    { userID: req.params.userId, isWithdrawn: { $ne: true } },
    { projection: { _id: 1, userID: 1, username: 1, position: 1, birthDate: 1, heightCm: 1, weightKg: 1 } }
  );
  if (!profileOwner) return res.status(404).render('error.ejs');
  if (!canViewMemberProfile(req.user, profileOwner)) return res.status(403).render('error.ejs');

  const isOwnProfile = req.user.userID === profileOwner.userID;
  const [mvpAwardCount, badges, clubEmblems, photoPostCount, commentCount, likedPhotoCount, statsResult] = await Promise.all([
    db.collection('mvp').countDocuments({ mvp_name: profileOwner.username }),
    db.collection('user_badges').find({ userID: profileOwner.userID }).sort({ createdAt: -1 }).toArray(),
    getUserClubEmblems(profileOwner.userID),
    db.collection('photo').countDocuments({ user: profileOwner._id }),
    db.collection('photo-comment').countDocuments({
      $or: [{ writerId: profileOwner._id }, { writer: profileOwner.username }]
    }),
    db.collection('photo').countDocuments({ likes: profileOwner.username }),
    db.collection('stats_result').findOne({ to_userID: profileOwner.userID }, { projection: { chr: 1 } })
  ]);
  const activityStats = {
    photoPostCount,
    commentCount,
    likedPhotoCount
  };
  let pushEnabled = false;
  if (isOwnProfile) {
    const subscriptionCount = await db.collection('push_subscription').countDocuments({ username: req.user.username });
    pushEnabled = req.user.pushNotificationsEnabled !== false && subscriptionCount > 0;
  }

  res.render('mypage.ejs', {
    유저: req.user,
    프로필유저: profileOwner,
    memberInfo: getMemberProfileInfo(profileOwner),
    memberTraits: getMemberTraits(statsResult),
    todayKey: getSeoulDateKey(),
    isOwnProfile,
    pushEnabled,
    mvpAwardCount,
    badges,
    clubEmblems,
    activityStats
  });
});

app.use((error, req, res, next) => {
  reportDeveloperError(error, req);
  console.error('Unhandled request error:', error);
  if (res.headersSent) return next(error);
  res.status(500).render('error.ejs');
});

if (require.main === module) {
  app.listen(process.env.PORT || 5000, () => {
    console.log(`http://localhost:${process.env.PORT || 5000} 에서 서버 실행 중`)
  })
}

module.exports = app;