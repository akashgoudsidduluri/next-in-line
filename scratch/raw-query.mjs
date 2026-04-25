import pg from "pg";
const { Client } = pg;

async function testQuery() {
  const client = new Client({
    connectionString: "postgresql://postgres:1602-akash-066@localhost:5432/hiring_db"
  });

  try {
    await client.connect();
    console.log("Connected to DB");
    
    const res = await client.query('SELECT "id", "name", "email", "password_hash", "created_at" FROM "companies" LIMIT 1');
    console.log("Query Successful:", res.rows);
  } catch (err) {
    console.error("Query Failed:", err.message);
    console.error("Full Error:", err);
  } finally {
    await client.end();
  }
}

testQuery();
