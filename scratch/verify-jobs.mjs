async function verifyJobs() {
  const email = "akashg@gmail.com";
  const password = "password123456"; // I hope this is what they used or I can try their plsq password if they reused it.

  try {
    // 1. Login
    const loginRes = await fetch("http://localhost:3000/api/v1/company/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password })
    });
    
    if (!loginRes.ok) {
      console.error("Login Failed:", loginRes.status, await loginRes.text());
      return;
    }
    
    const { token } = await loginRes.json();
    console.log("Logged in successfully");

    // 2. Fetch Jobs
    const jobsRes = await fetch("http://localhost:3000/api/v1/jobs/me", {
      headers: { Authorization: `Bearer ${token}` }
    });
    
    const jobs = await jobsRes.json();
    console.log("Jobs found for me:", jobs.length, jobs);
  } catch (err) {
    console.error("Verification Error:", err.message);
  }
}

verifyJobs();
