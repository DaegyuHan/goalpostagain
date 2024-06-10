// express 라이브러리 사용위함
const express = require('express')
const app = express()
const { MongoClient, ObjectId } = require('mongodb')
const methodOverride = require('method-override')
const bcrypt = require('bcrypt')
const ytdl = require('ytdl-core');
require('dotenv').config()

app.use(methodOverride('_method'))
app.use(express.static(__dirname + '/public')) // public 폴더 내의 파일을 사용할 수 있게 함 css,js,jpg 파일들(static 파일들)
app.set('view engine', 'ejs') // ejs setting
app.use(express.json())
app.use(express.urlencoded({ extended: true }))  // 유저가 데이터를 보냈을 때 꺼내쓸 수 있게 하는 코드

//
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

// passport 라이브러리 세팅
const session = require('express-session')
const passport = require('passport')
const LocalStrategy = require('passport-local')
const MongoStore = require('connect-mongo')

app.use(passport.initialize())
app.use(session({
  secret: '암호화에 쓸 비번',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 480 * 60 * 1000 },
  // 480분 / 60분 = 8 시간
  store: MongoStore.create({
    mongoUrl: 'mongodb+srv://sparta:test@cluster0.edvfknb.mongodb.net/?retryWrites=true&w=majority',
    dbName: 'goalpostagain'
  })
}))
app.use(passport.session())
//

const { S3Client } = require('@aws-sdk/client-s3')
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
    bucket: 'bigstarhan33',
    key: function (요청, file, cb) {
      cb(null, Date.now().toString()) //업로드시 파일명 변경가능
    }
  })
})



let connectDB = require('./database.js')

let db
connectDB.then((client) => {
  console.log('DB연결성공')
  db = client.db('goalpostagain')

  // 서버 띄우는 코드
  app.listen(process.env.PORT, () => {    //서버 띄울 포트 번호
    console.log('http://localhost:5000 에서 서버 실행 중')
  })
}).catch((err) => {
  console.log(err)
})
// mongoDB library 연결 코드



app.use((req, res, next) => {
  if (req.user) {
    res.locals.유저 = req.user || {};
  }
  next();
})



app.get('/', async (req, res) => {

  let result = await db.collection('mvp').find().sort({ _id: -1 }).limit(1).toArray();
  let Weeklymvp = result.length > 0 ? result[0].mvp : null;
  let match_result = await db.collection('result').find().sort({ _id: -1 }).toArray();
  let matchplan = await db.collection('matchplan').find().sort({ _id: -1 }).toArray();
  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;

  res.render('home.ejs', { MVP: Weeklymvp, 매치일정: matchplan, result: match_result, mvpboard: mvpboard });
})



app.get('/management', async (req, res) => {
  let result = await db.collection('notice').find().toArray();
  let matchplan = await db.collection('matchplan').find().sort({ _id: -1 }).toArray();
  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;

  res.render('management.ejs', { 글목록: result, 매치일정: matchplan, mvpboard: mvpboard });
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

  if (updateResult.modifiedCount === 1) {
    console.log("Result collection 업데이트 성공");
  } else {
    console.log("업데이트된 문서가 없습니다.");
  }

  res.redirect('/');
});

app.get('/mvpboard', async (req, res) => {
  let member_score = {
    박승룡: req.query.num1,
    오연택: req.query.num2,
    양철진: req.query.num4,
    석범수: req.query.num5,
    장희승: req.query.num6,
    노용준: req.query.num7,
    안태훈: req.query.num9,
    김정훈: req.query.num10,
    민대식: req.query.num11,
    이찬웅: req.query.num14,
    나현수: req.query.num23,
    한대규: req.query.num33,
    유성진: req.query.num96,
    황덕현: req.query.num99
  }
  let result = await db.collection('mvpboard').insertOne({
    member_score
  })
  res.redirect('/')
})

app.post('/match-plan', async (req, res) => {

  let previousAddress = req.body.planaddress;

  if (!previousAddress) {
    let lastRecord = await db.collection('matchplan').findOne({}, { sort: { _id: -1 } });
    if (lastRecord) {
      previousAddress = lastRecord.address;
    }
  }

  let result = db.collection('matchplan').insertOne({
    year: req.body.planyear,
    month: req.body.planmonth,
    date: req.body.plandate,
    day: req.body.planday,
    time: req.body.plantime,
    timeto: req.body.plantimeto,
    awayteam: req.body.planawayteam,
    place: req.body.planplace,
    address: previousAddress
  })
  res.redirect('/')
})

app.get('/result', async (req, res) => {
  let result = db.collection('result').insertOne({
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
  res.redirect('/match-result')
})

app.get('/match-result-delete/:id', async (req, res) => {
  let result = await db.collection('result').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('back')
})



passport.use(new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
  let result = await db.collection('user').findOne({ userID: 입력한아이디 })
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
  console.log(user)
  process.nextTick(() => {
    done(null, { id: user._id, userID: user.userID })
  })
})

passport.deserializeUser(async (user, done) => {
  try {
    let result = await db.collection('user').findOne({ _id: new ObjectId(user.id) });

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
    if (error) return res.status(500).json({ success: false, message: '서버 에러' });
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
        res.redirect('/notice/1')
      }
    } catch (e) {
      console.log(e)
      res.status(500).send('서버에러남')
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

  res.redirect('/notice/notice-detail/' + req.body.id)

})

app.get('/notice-delete/:id', async (req, res) => {
  let result = await db.collection('notice').deleteOne({
    _id: new ObjectId(req.params.id)
  })
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
        res.redirect('/update-note')
      }
    } catch (e) {
      console.log(e)
      res.status(500).send('서버에러남')
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
// app.get('/introduce', async (req, res) => {
//   const playerInfo = req.session.playerInfo;

//   if (req.user && req.user.userID) {
//     try {
//       const userID = req.user.userID;
//       const stats = await db.collection('stats').find({ userID: userID, 'stat.to_userID': playerInfo}).toArray();

//       // stats 변수를 introduce.ejs에 전달하여 렌더링
//       res.render('introduce.ejs', { 스탯: stats });
//     } catch (error) {
//       console.error(error);
//       res.status(500).send("서버 오류가 발생했습니다.");
//     }
//   } else {
//     res.render('introduce.ejs', { 스탯 : stats });
//   }
// });

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
          userID: playerInfo
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
      // 클라이언트에게 프로필 정보와 통계 정보 함께 응답
      res.json({
        profileImage: result[0].profileImage,
        backnumber: result[0].backnumber,
        username: result[0].username,
        stats: extractedStats // stats 데이터 추가
      });
      console.log(extractedStats)
    } else {
      console.log('해당하는 데이터가 없습니다.');
      res.status(404).json({ error: '데이터를 찾을 수 없습니다.' });
    }
  } catch (error) {
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
    // stats 컬렉션에 데이터 저장
    await db.collection('stats').updateOne(
      { userID: req.user.userID, "stat.to_userID": playerInfo },
      { $set: stats },
      { upsert: true }
    );

    // stats_result 컬렉션 업데이트
    await updateStatsResult(playerInfo);

    res.redirect('/introduce');
  } catch (error) {
    console.error('데이터 저장 중 오류 발생:', error.message);
    res.status(500).json({ error: '데이터 저장 중 오류가 발생했습니다.' });
  }
});

async function updateStatsResult(playerInfo) {
  // 특정 to_userID에 해당하는 stat들의 평균 계산하여 stats_result 컬렉션 업데이트
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
        avg_stat18: { $avg: "$stat.stat18" }
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
        avg_stat18: { $toInt: { $round: ["$avg_stat18", 0] }}
      }
    }
  ];

  const result = await db.collection('stats').aggregate(pipeline).toArray();

  if (result.length > 0) {
    // stats_result 컬렉션 업데이트
    await db.collection('stats_result').updateOne(
      { to_userID: playerInfo },
      { $set: result[0] },
      { upsert: true }
    );
  }
}


app.get('/match-result', async (req, res) => {
  let result = await db.collection('result').find().sort({ _id: -1 }).toArray();
  res.render('match-result.ejs', { result: result });
});

app.get('/gamezone-shooting', this.isLoggedIn, async (req, res, next) => {
  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;
  let ShootingScore = await db.collection('gamezone_shooting').find().toArray();


  res.render('gamezone-shooting.ejs', { mvpboard: mvpboard, ShootingScore: ShootingScore });
});

app.post('/gamezone-shooting-extrachance', async (req, res) => {
  let username = req.user.username;
  let userShootingCount = req.body.userShootingCount;
  console.log(userShootingCount)

  await db.collection('user').updateOne(
    { username: username },
    { $set: { shooting_count: userShootingCount } }
  );
  res.json({ success: true });
});

app.get('/gamezone-shooting-scoreboard-check', async (req, res) => {
  let username = req.user.username;
  let existingUser = await db.collection('gamezone_shooting').findOne({ name: username });

  if (existingUser) {
    res.json({ top_score: existingUser.top_score });
  } else {
    res.json({ top_score: 0 }); // or any default value if the user doesn't exist
  }
});


app.get('/gamezone-shooting-scoreboard', async (req, res) => {
  let score = parseInt(req.query.score);
  let username = req.user.username;

  // Check if the user exists in the collection
  let existingUser = await db.collection('gamezone_shooting').findOne({ name: username });

  if (existingUser) {
    // Update the top_score with the provided score
    await db.collection('gamezone_shooting').updateOne(
      { name: username },
      { $set: { top_score: score } }
    );
    console.log(`${username}'s top_score updated to ${score}`);
  } else {
    // If the user does not exist in the collection, insert a new record
    await db.collection('gamezone_shooting').insertOne({
      name: username,
      top_score: score
    });
    console.log(`${username}'s record inserted with top_score ${score}`);
  }

  res.redirect('back');
});


app.get('/reset-shootinggame', async (req, res) => {
  const collectionName = 'gamezone_shooting';

  const collection = db.collection(collectionName);
  await collection.deleteMany({});
  res.redirect('/')
})





app.get('/photo', this.isLoggedIn, async (req, res, next) => {
  try {
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
      }
    ]).toArray();
    res.render('photo.ejs', { 포토: result });
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
        res.redirect('/photo')
      }
    } catch (e) {
      console.log(e)
      res.status(500).send('서버에러남')
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
  let result = await db.collection('photo').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('/photo')
})

app.post('/photo-comment', async (req, res) => {


  await db.collection('photo-comment').insertOne({
    content: req.body.content,
    writerId: new ObjectId(req.user._id),
    writer: req.user.username,
    parentId: new ObjectId(req.body.parentId)
  })
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
  let URL = await db.collection('youtubeURL').find().sort({ _id: -1 }).toArray();
  res.render('video.ejs', { URL: URL });
});




app.get('/UploadURL', async (req, res) => {

  let result = await db.collection('youtubeURL').insertOne({
    URL: req.query.URL
  })
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

app.get('/mypage/:userId', async (req, res) => {

  res.render('mypage.ejs')
});