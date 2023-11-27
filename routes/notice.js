// const router = require('express').Router()

// let connectDB = require('./../database.js')

// let db
// connectDB.then((client) => {
//     db = client.db('goalpostagain')

//     // 서버 띄우는 코드

// }).catch((err) => {
//     console.log(err)
// })

// const { S3Client } = require('@aws-sdk/client-s3')
// const multer = require('multer')
// const multerS3 = require('multer-s3')
// const s3 = new S3Client({
//     region: 'ap-northeast-2',
//     credentials: {
//         accessKeyId: process.env.S3_KEY,
//         secretAccessKey: process.env.S3_SECRET
//     }
// })

// const upload = multer({
//     storage: multerS3({
//         s3: s3,
//         bucket: 'bigstarhan33',
//         key: function (요청, file, cb) {
//             cb(null, Date.now().toString()) //업로드시 파일명 변경가능
//         }
//     })
// })

// router.get('/notice', async (req, res) => {
//     let result = await db.collection('notice').find().toArray();
//     let Today = new Date().toLocaleString()
//     let user = req.user
//     console.log(Today)
//     res.render('notice.ejs', { 글목록: result, 날짜: Today, 유저: user });
// });

// router.post('/notice-post', async (req, res) => {
//     let Today = new Date().toLocaleString()
//     upload.single('img1')(req, res, async (err) => {
//         if (err) return res.send('업로드에러')
//         try {
//             if (req.body.title == '') {
//                 res.send('제목입력안했음')
//             } else {
//                 await db.collection('notice').insertOne(
//                     {
//                         today: Today,
//                         title: req.body.title,
//                         content: req.body.content,
//                         img: req.file ? req.file.location : '',
//                         user: req.user._id,
//                         username: req.user.username
//                     }
//                 )
//                 res.redirect('/notice')
//             }
//         } catch (e) {
//             console.log(e)
//             res.status(500).send('서버에러남')
//         }
//     })

// })

// router.get('/notice-detail/:id', async (req, res) => {
//     let notice = await db.collection('notice').find().toArray()
//     let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
//     res.render('notice-detail.ejs', { 글: postID, 글목록: notice })

// })

// router.get('/notice-edit/:id', async (req, res) => {
//     let postID = await db.collection('notice').findOne({ _id: new ObjectId(req.params.id) })
//     res.render('notice-edit.ejs', { 글: postID })
// })

// router.put('/notice-edit', async (req, res) => {

//     let result = await db.collection('notice').updateOne({ _id: new ObjectId(req.body.id) },
//         {
//             $set: {
//                 title: req.body.title,
//                 content: req.body.content
//             }
//         })


//     res.redirect('/notice')

// })

// router.get('/notice-delete/:id', async (req, res) => {
//     let result = await db.collection('notice').deleteOne({
//         _id: new ObjectId(req.params.id)
//     })

//     res.redirect('/notice')
// })

// module.exports = router