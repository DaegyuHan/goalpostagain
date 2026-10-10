const { MongoClient } = require('mongodb');

const url = process.env.DB_URL;
const client = new MongoClient(url, {
	maxPoolSize: 10,
	maxIdleTimeMS: 60_000,
	// 서버리스 함수 실행 제한보다 짧게 잡아, DB 장애 시 요청이 오래 매달리지 않도록 한다.
	serverSelectionTimeoutMS: 10_000
});

// 연결에 성공한 Promise만 재사용한다.
// 실패한 Promise를 계속 들고 있으면 해당 서버리스 인스턴스가 살아 있는 동안
// 모든 요청이 DB에 다시 접속해 보지도 않고 즉시(0.00초) 같은 오류로 실패한다.
let connectPromise = null;

function connectDB() {
	if (!connectPromise) {
		connectPromise = client.connect().catch((error) => {
			connectPromise = null;
			throw error;
		});
	}
	return connectPromise;
}

module.exports = connectDB;
