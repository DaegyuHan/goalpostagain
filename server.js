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
    console.log('http://localhost:3000 에서 서버 실행 중')
  })
}).catch((err) => {
  console.log(err)
})
// mongoDB library 연결 코드







app.get('/', async (req, res) => {     
  // res.sendFile(__dirname + '/index.ejs')
  let result = await db.collection('mvp').find().sort({ _id: -1 }).limit(1).toArray();
  let Weeklymvp = result.length > 0 ? result[0].mvp : null;
  res.render('home.ejs',{MVPname: Weeklymvp})
})

// app.use('/', require('./routes/notice.js'))


  app.get('/management', async (req, res) => {
    let result = await db.collection('notice').find().toArray();
    res.render('management.ejs', { 글목록: result});
});

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
     res.render('login.ejs');
  }
};

exports.isNotLoggedIn = (req, res, next) => {
  if (!req.isAuthenticated()) {
     next(); // 로그인 안되어있으면 다음 미들웨어
  } else {
     const message = encodeURIComponent('로그인한 상태입니다.');
     res.redirect(`/?error=${message}`);
  }
};

app.get('/login',this.isNotLoggedIn, async (req, res, next) => {
  console.log(req.user)
  res.render('login.ejs')
})

app.post('/login', async (req, res, next) => {
  passport.authenticate('local', (error, user, info) => {
    if (error) return res.status(500).json(error)
    if (!user) return res.status(401).json(info.message)
    req.logIn(user, (err) => {
      if (err) return next(err)
      res.redirect('/')
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

  let 해시 = await bcrypt.hash(req.body.password, 10)

  await db.collection('user').insertOne({
    userID: req.body.userID,
    username:req.body.username,
    password: 해시
  })
  res.redirect('/')
})


app.get('/notice', async (req, res) => {
  let result = await db.collection('notice').find().toArray();
  let Today = new Date().toLocaleDateString()

  console.log(Today)
  console.log(req.user)
  res.render('notice.ejs', { 글목록: result, 날짜: Today});
});

app.post('/notice-post', async (req, res) => {
  let Today = new Date().toLocaleDateString()
  upload.single('img1')(req, res, async (err) => {
      if (err) return res.send('업로드에러')
      try {
          if (req.body.title == '') {
              res.send('제목입력안했음')
          } else {
              await db.collection('notice').insertOne(
                  {
                      today: Today,
                      title: req.body.title,
                      content: req.body.content,
                      img: req.file ? req.file.location : '',
                      user: req.user._id,
                      username: req.user.username
                  }
              )
              res.redirect('/notice')
          }
      } catch (e) {
          console.log(e)
          res.status(500).send('서버에러남')
      }
  })

})

app.get('/notice-detail/:id', this.isLoggedIn, async (req, res, next) => {
  let notice = await db.collection('notice').find().toArray()
  let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
  let comment = await db.collection('comment').find({ parentId: new ObjectId(req.params.id) }).toArray()
  let user = req.user



  res.render('notice-detail.ejs', { 글: postID, 글목록: notice, 댓글: comment, 유저: user })

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


  res.redirect('/notice')

})

app.get('/notice-delete/:id', async (req, res) => {
  let result = await db.collection('notice').deleteOne({
      _id: new ObjectId(req.params.id)
  })

  res.redirect('/notice')
})

app.post('/comment', async (req, res) => {
  await db.collection('comment').insertOne({
    content: req.body.content,
    writerId: new ObjectId(req.user._id),
    writer: req.user.username,
    parentId: new ObjectId(req.body.parentId)
  })
  res.redirect('back')
})

app.get('/nav', async (req, res) => {
  let test = 'hi'

  res.render('nav', {test})
})

app.get('/mvp', async (req, res) => {
  let result = db.collection('mvp').insertOne({
    mvp : req.query.val
  })
  res.redirect('/')
})