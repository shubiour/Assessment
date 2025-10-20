import fetch from "node-fetch";

const API_KEY = "ak_efe3fafc1d8b661d2edb28e1f53a555ae56b2cf1f3455e97";
const BASE_URL = "https://assessment.ksensetech.com/api";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* -------------------------------
   STEP 1: Fetch all patients
--------------------------------*/
async function getAllPatients() {
  const patients = [];
  let page = 1;
  let hasNext = true;

  while (hasNext) {
    let retries = 0;
    let success = false;

    while (!success && retries < 3) {
      try {
        const res = await fetch(`${BASE_URL}/patients?page=${page}&limit=5`, {
          headers: { "x-api-key": API_KEY },
        });

        if (res.status === 429) {
          console.log("Rate limited — waiting 2s...");
          await sleep(2000);
          continue;
        }

        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();

        if (Array.isArray(json.data)) patients.push(...json.data);
        hasNext = json.pagination?.hasNext;
        page++;
        success = true;
      } catch (err) {
        retries++;
        console.log(`Retry ${retries} on page ${page} (${err.message})`);
        await sleep(1000 * retries);
      }
    }

    if (!success) {
      console.log(`⚠️ Failed to fetch page ${page}. Moving on.`);
      hasNext = false;
    }
  }

  console.log(`Fetched ${patients.length} patients total.`);
  return patients;
}

/* -------------------------------
   STEP 2: Risk scoring functions
--------------------------------*/

// Improved BP parsing (handles partial values like "140/" or "/90")
function parseBP(bp) {
  if (!bp || typeof bp !== "string") return [null, null];
  const [sysRaw, diaRaw] = bp.split("/");
  const sys = sysRaw ? parseInt(sysRaw) : null;
  const dia = diaRaw ? parseInt(diaRaw) : null;
  return [isNaN(sys) ? null : sys, isNaN(dia) ? null : dia];
}

function bpRisk(bp) {
  const [sys, dia] = parseBP(bp);
  if (!sys && !dia) return 0;

  if ((sys && sys >= 140) || (dia && dia >= 90)) return 4;
  if ((sys && sys >= 130 && sys <= 139) || (dia && dia >= 80 && dia <= 89)) return 3;
  if (sys && sys >= 120 && sys <= 129 && (!dia || dia < 80)) return 2;
  if ((sys && sys < 120) && (dia && dia < 80)) return 1;
  return 0;
}

function tempRisk(temp) {
  const t = parseFloat(temp);
  if (isNaN(t)) return 0;
  if (t <= 99.5) return 0;
  if (t >= 99.6 && t <= 100.9) return 1;
  if (t >= 101) return 2;
  return 0;
}

function ageRisk(age) {
  const a = parseInt(age);
  if (isNaN(a)) return 0;
  if (a < 40) return 1;
  if (a <= 65) return 1;
  if (a > 65) return 2;
  return 0;
}

/* -------------------------------
   STEP 3: Process and classify
--------------------------------*/
function classifyPatients(patients) {
  const results = {
    high_risk_patients: [],
    fever_patients: [],
    data_quality_issues: [],
  };

  for (const p of patients) {
    const bpScore = bpRisk(p.blood_pressure);
    const tempScore = tempRisk(p.temperature);
    const ageScore = ageRisk(p.age);
    const total = bpScore + tempScore + ageScore;

    // 1️⃣ High Risk (≥4)
    if (total >= 4) results.high_risk_patients.push(p.patient_id);

    // 2️⃣ Fever (≥99.5°F)
    const t = parseFloat(p.temperature);
    if (!isNaN(t) && t >= 99.5) results.fever_patients.push(p.patient_id);

    // 3️⃣ Data Quality Issues (only truly missing)
    const hasMissing =
      !p.blood_pressure ||
      p.blood_pressure === "" ||
      p.age === null ||
      p.age === "" ||
      p.temperature === null ||
      p.temperature === "";

    if (hasMissing) results.data_quality_issues.push(p.patient_id);
  }

  return results;
}

/* -------------------------------
   STEP 4: Submit results
--------------------------------*/
async function submitResults(results) {
  const res = await fetch(`${BASE_URL}/submit-assessment`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": API_KEY,
    },
    body: JSON.stringify(results),
  });

  const data = await res.json();
  console.log("Submission Response:", JSON.stringify(data, null, 2));
}

/* -------------------------------
   STEP 5: Run it all
--------------------------------*/
(async () => {
  const patients = await getAllPatients();
  const results = classifyPatients(patients);

  console.log("\nGenerated Results:");
  console.log(JSON.stringify(results, null, 2));

  await submitResults(results);
})();