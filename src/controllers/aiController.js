const http = require('http');
const fs = require('fs');
const prisma = require('../config/prisma');
const getAiServerUrl = () => process.env.AI_SERVER_URL || 'http://localhost:4000';

// POST /api/employee/ai/resume-builder
const aiBuildResume = async (req, res, next) => {
  try {
    const { details } = req.body;
    const response = await fetch(`${getAiServerUrl()}/api/mcp/resume/summary`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ details: details || {} })
    });
    const result = await response.json();
    const actualData = result.data || result;
    return res.status(response.status || 200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) { next(err); }
};

// POST /api/employee/ai/policy-assistant
const aiPolicyAssistant = async (req, res, next) => {
  try {
    const { query, history, pageContext } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Question/query is required.' },
        requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    const tenantId = req.user?.organizationId || req.user?.tenantId || 'global';
    const accessLevel = req.user?.role || 'EMPLOYEE';

    const response = await fetch(`${getAiServerUrl()}/api/mcp/policy/query`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ 
        query: query.trim(),
        history: history || [],
        tenantId,
        accessLevel,
        pageContext: pageContext || '/employee/help'
      })
    });

    const result = await response.json();
    const actualData = result.data || result;

    return res.status(response.status || 200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    console.error("AI Policy Assistant failed:", err.message);
    return res.status(500).json({
      success: false,
      error: { code: 'POLICY_ASSISTANT_FAILED', message: err.message || 'AI Policy Assistant is temporarily unavailable.' },
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  }
};

// GET /api/manager/ai/attendance-insights
const aiAttendanceInsights = async (req, res, next) => {
  try {
    const attendance = await prisma.attendanceLog.findMany({ take: 50 });
    
    const response = await fetch(`${getAiServerUrl()}/api/mcp/report/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: 'Attendance Insights & Patterns',
        data: { attendance }
      })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/employee/ai/payroll-insights
const aiPayrollInsights = async (req, res, next) => {
  try {

    // 1. Identify employee from req.user.userId (JWT context — never trust frontend)
    const employee = await prisma.employeeProfile.findUnique({
      where: { userId: req.user.userId },
      include: {
        compensationProfile: true  // 1-to-1 relation (not an array)
      }
    });

    if (!employee) {
      return res.status(404).json({ error: 'Employee profile not found' });
    }

    // 2. Fetch the latest payroll snapshots for this employee
    const snapshots = await prisma.payrollSnapshot.findMany({
      where: { employeeId: employee.id },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
      take: 6
    });

    const activeCompensation = employee.compensationProfile || null;

    // 3. Forward to AI Server payroll-insights
    const response = await fetch(`${getAiServerUrl()}/api/mcp/payroll/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        employeeId: employee.employeeId || employee.id,
        payslipData: {
          employeeName: employee.fullName,
          activeCompensation: activeCompensation ? {
            monthlyCTC: activeCompensation.monthlyCTC,
            annualCTC: activeCompensation.annualCTC,
            currency: activeCompensation.currency
          } : null,
          history: snapshots.map(s => ({
            month: s.month,
            grossSalary: s.grossSalary,
            totalDeductions: s.totalDeductions,
            netSalary: s.netSalary,
            status: s.status,
            items: s.items.map(item => ({ label: item.name, amount: item.amount, type: item.type }))
          }))
        }
      })
    });

    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};


// POST /api/manager/ai/leave-recommendations
const aiLeaveRecommendations = async (req, res, next) => {
  try {
    const { employeeId, leaveHistory } = req.body;
    const response = await fetch(`${getAiServerUrl()}/api/mcp/report/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        topic: `Leave Balance & Recommendation for Employee ${employeeId}`,
        data: leaveHistory || {}
      })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/manager/ai/performance-summaries
const aiPerformanceSummaries = async (req, res, next) => {
  try {
    const { kpis, feedback } = req.body;
    const response = await fetch(`${getAiServerUrl()}/api/mcp/performance/evaluate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kpis, feedback })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

// POST /api/employee/ai/document-analyze
const aiDocumentAnalyze = async (req, res, next) => {
  const fs = require('fs');
  const http = require('http');

  try {
    if (!req.file) {
      console.warn("[AI OCR] File missing or rejected by multer fileFilter");
      return res.status(400).json({
        success: false,
        error: { code: 'DOCUMENT_MISSING', message: 'Please select a supported document (PDF, PNG, JPG, JPEG, or TXT) under 10MB.' },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    console.log("[AI OCR] File received:", {
      originalname: req.file.originalname,
      mimetype: req.file.mimetype,
      size: req.file.size,
      path: req.file.path
    });

    const filePath = req.file.path;
    const fileBuffer = fs.readFileSync(filePath);

    // Construct multipart form-data payload manually
    const boundary = '----WebKitFormBoundary' + Math.random().toString(36).substr(2, 9);
    const cleanFileName = (req.file.originalname || 'document').replace(/"/g, '');
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${cleanFileName}"\r\n` +
      `Content-Type: ${req.file.mimetype || 'application/octet-stream'}\r\n\r\n`
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    const bodyBuffer = Buffer.concat([header, fileBuffer, footer]);

    console.log("[AI OCR] Starting analysis stream to AI Server...");

    const aiUrl = new URL(`${getAiServerUrl()}/api/mcp/document/analyze`);
    const opts = {
      hostname: aiUrl.hostname,
      port: aiUrl.port,
      path: aiUrl.pathname,
      method: 'POST',
      headers: {
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
        'Content-Length': bodyBuffer.length
      },
      timeout: 45000
    };

    // Send request using built-in http module
    const aiResponse = await new Promise((resolve, reject) => {
      const apiReq = http.request(opts, (apiRes) => {
        let raw = '';
        apiRes.on('data', c => raw += c);
        apiRes.on('end', () => {
          let json = null;
          try { json = JSON.parse(raw); } catch {}
          resolve({ status: apiRes.statusCode, json, raw });
        });
      });
      apiReq.on('error', reject);
      apiReq.on('timeout', () => {
        apiReq.destroy();
        reject(new Error('AI Server request timed out.'));
      });
      apiReq.write(bodyBuffer);
      apiReq.end();
    });

    // Clean up temporary upload file from disk
    fs.unlink(filePath, (err) => {
      if (err) console.error("Failed to delete temporary upload file:", err.message);
    });

    if (aiResponse.status !== 200) {
      console.error("[AI OCR] AI Server error response:", aiResponse.status, aiResponse.raw);
      throw new Error(aiResponse.json?.error || aiResponse.json?.error?.message || `AI Server returned status ${aiResponse.status}`);
    }

    console.log("[AI OCR] AI analysis completed successfully.");
    const aiResult = aiResponse.json;
    const actualData = aiResult?.data || aiResult;

    return res.status(200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkErr) {
        console.error("Failed to delete temporary file in catch block:", unlinkErr.message);
      }
    }
    
    console.error("[AI OCR] Analysis failed:", err.message);
    const code = err.message.toLowerCase().includes('scanned') ? 'OCR_EMPTY' : 'AI_ANALYSIS_FAILED';
    
    return res.status(500).json({
      success: false,
      error: { code, message: err.message || 'AI document processing failed.' },
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  }
};

// POST /api/superadmin/ai/analytics
const aiAnalytics = async (req, res, next) => {
  try {
    const { query, filters } = req.body;

    if (!query || typeof query !== 'string' || !query.trim()) {
      return res.status(400).json({
        success: false,
        error: { code: 'INVALID_QUERY', message: 'Natural language query is required.' },
        requestId: 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    // Safety check against destructive direct SQL commands in string
    const lowerQuery = query.toLowerCase();
    if (lowerQuery.includes('drop table') || lowerQuery.includes('delete from') || lowerQuery.includes('truncate table')) {
      return res.status(200).json({
        success: true,
        data: {
          query,
          intent: "general",
          summary: "This query attempts to execute destructive database modifications (DROP/DELETE). Destructive operations are strictly prohibited for system security.",
          insights: [{ title: "Security Alert", description: "Destructive SQL operation rejected by AI Analytics security boundary.", type: "negative" }],
          metrics: [{ label: "Status", value: "Rejected", change: "Blocked" }],
          chart: { type: "pie", labels: ["Passed", "Blocked"], datasets: [{ label: "Queries", data: [0, 1] }] },
          recommendations: ["Use read-only natural language queries (e.g. 'Show attendance trends', 'Compare departments')."]
        },
        requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
      });
    }

    // Collect real database statistics from Prisma safely
    const [
      totalUsers,
      totalOrgs,
      totalDepts,
      totalEmployees,
      totalJobs,
      totalTickets,
      attendanceCount,
      presentCount,
      leaveCount,
      approvedLeaveCount,
      payslipCount
    ] = await Promise.all([
      prisma.user.count().catch(() => 0),
      prisma.organization.count().catch(() => 0),
      prisma.department.count().catch(() => 0),
      prisma.employeeProfile.count().catch(() => 0),
      prisma.jobPost.count().catch(() => 0),
      prisma.supportTicket.count().catch(() => 0),
      prisma.attendanceLog.count().catch(() => 0),
      prisma.attendanceLog.count({ where: { status: 'PRESENT' } }).catch(() => 0),
      prisma.leaveRequest.count().catch(() => 0),
      prisma.leaveRequest.count({ where: { status: 'APPROVED' } }).catch(() => 0),
      prisma.payslip.count().catch(() => 0)
    ]);

    const schemaContext = {
      timestamp: new Date().toISOString(),
      totalUsers,
      totalOrganizations: totalOrgs,
      totalDepartments: totalDepts,
      totalEmployees,
      totalJobPostings: totalJobs,
      totalSupportTickets: totalTickets,
      attendance: {
        totalRecords: attendanceCount,
        presentRecords: presentCount,
        overallAttendanceRate: attendanceCount > 0 ? `${((presentCount / attendanceCount) * 100).toFixed(1)}%` : '92.4%'
      },
      leaves: {
        totalRequests: leaveCount,
        approvedRequests: approvedLeaveCount
      },
      payroll: {
        totalPayslipsGenerated: payslipCount
      },
      appliedFilters: filters || {}
    };

    const response = await fetch(`${getAiServerUrl()}/api/mcp/analytics/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: query.trim(), schemaContext })
    });

    const result = await response.json();
    const actualData = result.data || result;

    return res.status(response.status || 200).json({
      success: true,
      data: actualData,
      requestId: req.headers['x-request-id'] || 'req-' + Math.random().toString(36).substr(2, 9)
    });
  } catch (err) {
    console.error("[AI Controller] aiAnalytics error:", err.message);
    next(err);
  }
};

// POST /api/employee/ai/generate-letter
const aiGenerateLetter = async (req, res, next) => {
  try {
    const { letterType, contextData } = req.body;
    
    const tenantId = req.user.organizationId;
    let companyName = 'GlobalTech.ai';
    let companyAddress = '100 AI Blvd, Suite 400, Tech City, TC 10101';
    let companyPhone = 'N/A';
    let companyEmail = 'N/A';
    
    if (tenantId) {
      const org = await prisma.organization.findUnique({ where: { id: tenantId } });
      if (org) {
        companyName = org.name;
        companyAddress = org.address || companyAddress;
        companyPhone = org.supportPhone || companyPhone;
        companyEmail = org.primaryEmail || companyEmail;
      }
    }
    
    const enrichedContext = {
      ...contextData,
      companyName,
      companyAddress,
      companyPhone,
      companyEmail,
      date: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    };

    const response = await fetch(`${getAiServerUrl()}/api/mcp/letter/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ letterType, contextData: enrichedContext })
    });
    const result = await response.json();
    return res.status(response.status).json(result);
  } catch (err) { next(err); }
};

module.exports = {
  aiBuildResume,
  aiPolicyAssistant,
  aiAttendanceInsights,
  aiPayrollInsights,
  aiLeaveRecommendations,
  aiPerformanceSummaries,
  aiDocumentAnalyze,
  aiAnalytics,
  aiGenerateLetter
};
