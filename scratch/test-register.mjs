async function testRegister() {
  try {
    const res = await fetch("http://localhost:3000/api/v1/company/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Certification Test INC",
        email: `test-${Date.now()}@test.com`,
        password: "password123456"
      })
    });
    const data = await res.json();
    if (res.ok) {
      console.log("Registration Successful:", data);
    } else {
      console.error("Registration Failed:", res.status, data);
    }
  } catch (err) {
    console.error("Request Error:", err.message);
  }
}

testRegister();
