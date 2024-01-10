// express 라이브러리 사용위함
const express = require('express')
const app = express()
const { MongoClient, ObjectId } = require('mongodb')
const methodOverride = require('method-override')
const bcrypt = require('bcrypt')
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
  cookie: { maxAge: 60 * 60 * 1000 },
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
    res.locals.유저 = req.user.username; 
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

  res.render('home.ejs', { MVP: Weeklymvp, 매치일정: matchplan, result : match_result, mvpboard : mvpboard });
})



app.get('/management', async (req, res) => {
  let result = await db.collection('notice').find().toArray();
  let matchplan = await db.collection('matchplan').find().sort({ _id: -1 }).toArray();
  let mvpboardDic = await db.collection('mvpboard').find().sort({ _id: -1 }).limit(1).toArray();
  let mvpboard = mvpboardDic[0].member_score;

  res.render('management.ejs', { 글목록: result, 매치일정: matchplan, mvpboard : mvpboard });
});

app.get('/mvp', async (req, res) => {
  let result = await db.collection('mvp').insertOne({
    mvp: req.query.val,
    month : req.query.month,
    day : req.query.day
  })
  res.redirect('/')
})



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
    이찬웅: req.query.num14,
    나현수: req.query.num23,
    한대규: req.query.num33,
    유성진: req.query.num96
  }
  let result = await db.collection('mvpboard').insertOne({
    member_score
  })
  res.redirect('/')
})

app.post('/match-plan', async (req, res) => {
  let result = db.collection('matchplan').insertOne({
    month: req.body.planmonth,
    date : req.body.plandate,
    time : req.body.plantime,
    timeto : req.body.plantimeto,
    awayteam : req.body.planawayteam,
    place : req.body.planplace,
    address : req.body.planaddress
  })
  res.redirect('/')
})

app.get('/result', async (req, res) => {
  let result = db.collection('result').insertOne({
    month: req.query.month,
    day : req.query.day,
    time : req.query.time,
    place : req.query.place,
    homescore : req.query.homescore,
    awayscore : req.query.awayscore,
    awayname : req.query.awayname,
    resultlogo : req.query.resultlogo,
    home_resultlogo : req.query.home_resultlogo
  })
  res.redirect('/match-result')
})

app.get('/match-result-delete/:id', async (req, res) => {
  let result = await db.collection('result').deleteOne({
    _id: new ObjectId(req.params.id)
  })
  res.redirect('back')
})

app.get('/management/notice-post', async (req, res) => {

  res.render('notice-post.ejs');
});

passport.use(new LocalStrategy(async (입력한아이디, 입력한비번, cb) => {
  let result = await db.collection('user').findOne({ userID: 입력한아이디 })
  if (!result) {
    return cb(null, false, { message: '아이디 DB에 없음' })
  }


  if (await bcrypt.compare(입력한비번, result.password)) {
    return cb(null, result)
  } else {
    return cb(null, false, { message: '비번불일치' });
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
  let result = await db.collection('user').findOne({ _id: new ObjectId(user.id) })
  delete result.password
  process.nextTick(() => {
    done(null, result)
  })
})

exports.isLoggedIn = (req, res, next) => {
  // isAuthenticated()로 검사해 로그인이 되어있으면
  if (req.isAuthenticated()) {
    next(); // 다음 미들웨어
  } else {
    res.render('login', { Needlogin_Message: '로그인이 필요합니다.' });
  }
};

exports.isNotLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
    next(); // 로그인 안되어있으면 다음 미들웨어
  } else {
    const message = encodeURIComponent('로그인한 상태입니다.');
    // res.redirect(`/?error=${message}`);
    res.redirect('/');
  }
};

app.get('/login', this.isNotLoggedIn, async (req, res, next) => {

  res.render('login.ejs')
})

app.post('/login', async (req, res, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) return res.status(500).json(error)
    if (!user) return res.status(401).json(info.message)
    req.logIn(user, (err) => {
      if (err) return next(err)
      res.redirect('back')
    })

  })(req, res, next)

})



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
  let Time =  new Date().toLocaleString('ko-KR', { timeZone });
  let 해시 = await bcrypt.hash(req.body.password, 10)

  if (req.body.memberCode == 'bigstarhan') {
    await db.collection('user').insertOne({
      userID: req.body.userID,
      username: req.body.username,
      password: 해시,
      time : Time
    })
    res.render('login', { Register_Message: '회원가입이 완료되었습니다.' });
  }
  else {
    res.render('register', { Member_Message: '멤버코드가 일치하지 않습니다.' });
  }

})


app.get('/notice', async (req, res) => {
  let result = await db.collection('notice').find().sort({ _id: -1 }).toArray();

  res.render('notice.ejs', { 글목록: result});
});


app.get('/notice/:number', async (req, res) => {
  // let result = await db.collection('notice').find().sort({ _id: -1 }).skip((req.params.number - 1) * 10).limit(10).toArray()
  let result = await db.collection('notice').find().sort({ _id: -1 }).skip((req.params.number -1 ) * 10).limit(10).toArray();
  let result2 = await db.collection('notice').find().sort({ _id: -1 }).toArray();
  res.render('notice.ejs', { 글목록: result, 글전체: result2})
})


app.get('/notice-search', async (req, res) => {
  let result = await db.collection('notice')
    .find({
      $or: [
        { title: { $regex: req.query.search } },
        { content: { $regex: req.query.search } }
      ]
    }).toArray()

  res.render('notice-search.ejs', { 글목록: result})
})


app.post('/notice-post', async (req, res) => {

  const timeZone = 'Asia/Seoul';

  let Today = new Date().toLocaleDateString('ko-KR', { timeZone });
  let Time =  new Date().toLocaleString('ko-KR', { timeZone });
  upload.array('img1',5)(req, res, async (err) => {
    if (err) return res.send('업로드에러')
    try {
      if (req.body.title == '') {
        res.send('제목입력안했음')
      } else {
        const imageArray = req.files.length > 0 ? req.files.map(file => ({ filename: file.filename, location: file.location })) : [];
        
        await db.collection('notice').insertOne(
          {
            today: Today,
            time : Time,
            title: req.body.title,
            content: req.body.content,
            img : imageArray,
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
  let notice = await db.collection('notice').find().toArray()
  let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
  let comment = await db.collection('comment').find({ parentId: new ObjectId(req.params.id) }).toArray()

  res.render('notice-detail.ejs', { 글: postID, 글목록: notice, 댓글: comment})

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





app.get('/introduce', async (req, res) => {

  res.render('introduce.ejs');
});

app.get('/match-result', async (req, res) => {
  let result = await db.collection('result').find().sort({ _id: -1 }).toArray();
  res.render('match-result.ejs', {result : result});
});

app.get('/gamezone', async (req, res) => {

  res.render('gamezone.ejs');
});

app.get('/photo', async (req, res) => {

  res.render('photo.ejs');
});