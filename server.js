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





app.get('/', (req, res) => {      //간단한 서버 기능, 누가 메인페이지 접속 시 응답함
  res.sendFile(__dirname + '/index.html')
})

app.get('/notice', async (req, res) => {
      let result = await db.collection('notice').find().toArray();
      let Today = new Date().toLocaleString()
      console.log(Today)
      res.render('notice.ejs', { 글목록: result, 날짜: Today});
  });

  app.get('/management', async (req, res) => {
    let result = await db.collection('notice').find().toArray();
    res.render('management.ejs', { 글목록: result});
});

app.get('/management/notice-post', async (req, res) => {
  res.render('notice-post.ejs');
});

app.post('/notice-post', async (req, res) => {
  let Today = new Date().toLocaleString()
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

app.get('/notice-detail/:id', async (req, res) => {
  let notice = await db.collection('notice').find().toArray()
  let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
  res.render('notice-detail.ejs', {글: postID,  글목록: notice})

})

app.get('/notice-edit/:id', async (req, res) => {
  let postID = await db.collection('notice').findOne({ _id : new ObjectId(req.params.id)})
  res.render('notice-edit.ejs', {글: postID})
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