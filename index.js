// SmartBizCalc MCP Server — Cloudflare Worker
// Exposes 7 business calculator tools via MCP HTTP (streamable HTTP transport)

const SERVER_INFO = { name: "sbc-mcp", version: "1.0.0" };

const TOOLS = [
  {
    name: "break_even_calculator",
    description: "Calculate how many units must be sold to cover all costs. Returns units to break even, break-even revenue, and contribution margin.",
    inputSchema: {
      type: "object",
      properties: {
        fixed_costs: { type: "number", description: "Total fixed costs per period (rent, salaries, insurance, etc.)" },
        variable_cost_per_unit: { type: "number", description: "Variable cost to produce or deliver each unit" },
        selling_price_per_unit: { type: "number", description: "Selling price per unit" },
      },
      required: ["fixed_costs", "variable_cost_per_unit", "selling_price_per_unit"],
    },
  },
  {
    name: "profit_margin_calculator",
    description: "Calculate gross and net profit margins from revenue and costs.",
    inputSchema: {
      type: "object",
      properties: {
        revenue: { type: "number", description: "Total revenue" },
        cogs: { type: "number", description: "Cost of goods sold (direct costs)" },
        operating_expenses: { type: "number", description: "Operating expenses (overhead, SG&A). Optional.", default: 0 },
      },
      required: ["revenue", "cogs"],
    },
  },
  {
    name: "markup_calculator",
    description: "Calculate selling price from cost and desired markup percentage, plus the resulting margin.",
    inputSchema: {
      type: "object",
      properties: {
        cost: { type: "number", description: "Your cost to produce or acquire the item" },
        markup_percent: { type: "number", description: "Desired markup percentage (e.g. 50 for 50%)" },
      },
      required: ["cost", "markup_percent"],
    },
  },
  {
    name: "business_loan_calculator",
    description: "Calculate monthly payment, total repayment, and total interest for a business loan.",
    inputSchema: {
      type: "object",
      properties: {
        loan_amount: { type: "number", description: "Loan principal amount" },
        annual_interest_rate: { type: "number", description: "Annual interest rate as a percentage (e.g. 7.5 for 7.5%)" },
        term_months: { type: "number", description: "Loan term in months" },
      },
      required: ["loan_amount", "annual_interest_rate", "term_months"],
    },
  },
  {
    name: "roi_calculator",
    description: "Calculate ROI percentage and payback period from an investment and its net profit.",
    inputSchema: {
      type: "object",
      properties: {
        initial_investment: { type: "number", description: "Total initial investment amount" },
        net_profit: { type: "number", description: "Net profit or gain from the investment" },
        time_period_months: { type: "number", description: "Time period over which profit was earned in months (default 12).", default: 12 },
      },
      required: ["initial_investment", "net_profit"],
    },
  },
  {
    name: "contractor_pricing_calculator",
    description: "Calculate a project price for contractors (HVAC, cleaning, construction, etc.) from labor, materials, overhead, and desired margin.",
    inputSchema: {
      type: "object",
      properties: {
        labor_hours: { type: "number", description: "Estimated labor hours for the job" },
        hourly_rate: { type: "number", description: "Fully-loaded hourly labor rate (including burdens)" },
        material_cost: { type: "number", description: "Total cost of materials" },
        overhead_percent: { type: "number", description: "Overhead as % of total costs (default 15)", default: 15 },
        profit_margin_percent: { type: "number", description: "Desired profit margin % (default 20)", default: 20 },
      },
      required: ["labor_hours", "hourly_rate", "material_cost"],
    },
  },
  {
    name: "cash_flow_calculator",
    description: "Calculate monthly net cash flow and cash runway given current reserves.",
    inputSchema: {
      type: "object",
      properties: {
        monthly_revenue: { type: "number", description: "Average monthly revenue or inflows" },
        monthly_expenses: { type: "number", description: "Average monthly expenses or outflows" },
        cash_on_hand: { type: "number", description: "Current cash balance (optional — used to calculate runway)", default: 0 },
      },
      required: ["monthly_revenue", "monthly_expenses"],
    },
  },
];

function runTool(name, args) {
  const n = (v, d = 2) => parseFloat(v.toFixed(d));

  if (name === "break_even_calculator") {
    const { fixed_costs, variable_cost_per_unit, selling_price_per_unit } = args;
    const cm = selling_price_per_unit - variable_cost_per_unit;
    if (cm <= 0) return { error: "Selling price must exceed variable cost per unit." };
    const units = fixed_costs / cm;
    return {
      units_to_break_even: Math.ceil(units),
      revenue_at_break_even: n(units * selling_price_per_unit),
      contribution_margin_per_unit: n(cm),
      contribution_margin_ratio: n(cm / selling_price_per_unit * 100, 1) + "%",
    };
  }

  if (name === "profit_margin_calculator") {
    const { revenue, cogs, operating_expenses = 0 } = args;
    const gross = revenue - cogs;
    const net = gross - operating_expenses;
    return {
      gross_profit: n(gross),
      gross_margin_percent: n(gross / revenue * 100, 1),
      net_profit: n(net),
      net_margin_percent: n(net / revenue * 100, 1),
    };
  }

  if (name === "markup_calculator") {
    const { cost, markup_percent } = args;
    const price = cost * (1 + markup_percent / 100);
    const profit = price - cost;
    return {
      selling_price: n(price),
      profit_per_unit: n(profit),
      margin_percent: n(profit / price * 100, 1),
    };
  }

  if (name === "business_loan_calculator") {
    const { loan_amount, annual_interest_rate, term_months } = args;
    const r = annual_interest_rate / 100 / 12;
    const pmt = r === 0 ? loan_amount / term_months
      : loan_amount * (r * Math.pow(1 + r, term_months)) / (Math.pow(1 + r, term_months) - 1);
    const total = pmt * term_months;
    return {
      monthly_payment: n(pmt),
      total_repayment: n(total),
      total_interest: n(total - loan_amount),
    };
  }

  if (name === "roi_calculator") {
    const { initial_investment, net_profit, time_period_months = 12 } = args;
    const roi = net_profit / initial_investment * 100;
    const ann = roi / time_period_months * 12;
    const payback = initial_investment / (net_profit / time_period_months);
    return {
      roi_percent: n(roi, 1),
      annualized_roi_percent: n(ann, 1),
      payback_period_months: n(payback, 1),
    };
  }

  if (name === "contractor_pricing_calculator") {
    const { labor_hours, hourly_rate, material_cost, overhead_percent = 15, profit_margin_percent = 20 } = args;
    const labor = labor_hours * hourly_rate;
    const sub = labor + material_cost;
    const overhead = sub * (overhead_percent / 100);
    const total_cost = sub + overhead;
    const price = total_cost / (1 - profit_margin_percent / 100);
    const profit = price - total_cost;
    return {
      labor_cost: n(labor),
      material_cost: n(material_cost),
      overhead: n(overhead),
      total_cost: n(total_cost),
      project_price: n(price),
      profit: n(profit),
      markup_on_cost_percent: n(profit / total_cost * 100, 1),
    };
  }

  if (name === "cash_flow_calculator") {
    const { monthly_revenue, monthly_expenses, cash_on_hand = 0 } = args;
    const net = monthly_revenue - monthly_expenses;
    const runway = (net < 0 && cash_on_hand > 0) ? n(cash_on_hand / Math.abs(net), 1) : null;
    return {
      net_monthly_cash_flow: n(net),
      annual_cash_flow: n(net * 12),
      status: net > 0 ? "positive" : net < 0 ? "negative" : "break-even",
      runway_months: runway ?? "N/A (positive cash flow)",
    };
  }

  return { error: `Unknown tool: ${name}` };
}

function handleMCP(req) {
  const { id, method, params } = req;

  if (method === "initialize") {
    return {
      jsonrpc: "2.0", id,
      result: {
        protocolVersion: "2024-11-05",
        capabilities: { tools: { listChanged: false } },
        serverInfo: SERVER_INFO,
        instructions: "SmartBizCalc MCP provides 7 business calculator tools for small business owners, contractors, and entrepreneurs: break-even, profit margin, markup, loan payments, ROI, contractor pricing, and cash flow.",
      },
    };
  }

  if (method === "notifications/initialized") {
    return { jsonrpc: "2.0", id };
  }

  if (method === "tools/list") {
    return { jsonrpc: "2.0", id, result: { tools: TOOLS } };
  }

  if (method === "tools/call") {
    const { name, arguments: args } = params;
    try {
      const result = runTool(name, args || {});
      return {
        jsonrpc: "2.0", id,
        result: { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] },
      };
    } catch (e) {
      return { jsonrpc: "2.0", id, error: { code: -32603, message: String(e) } };
    }
  }

  return { jsonrpc: "2.0", id, error: { code: -32601, message: `Method not found: ${method}` } };
}

function withCORS(res) {
  const headers = new Headers(res.headers);
  headers.set("Access-Control-Allow-Origin", "*");
  headers.set("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization");
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request) {
    if (request.method === "OPTIONS") {
      return withCORS(new Response(null, { status: 204 }));
    }

    const url = new URL(request.url);

    if (url.pathname === "/") {
      return withCORS(new Response(JSON.stringify({
        name: "SmartBizCalc MCP Server",
        description: "7 business calculator tools for small business owners via MCP",
        mcp_endpoint: `${url.origin}/mcp`,
        tools: TOOLS.map(t => ({ name: t.name, description: t.description })),
      }, null, 2), { headers: { "Content-Type": "application/json" } }));
    }

    if (url.pathname !== "/mcp" || request.method !== "POST") {
      return withCORS(new Response("Not found", { status: 404 }));
    }

    try {
      const body = await request.json();
      const response = handleMCP(body);
      return withCORS(new Response(JSON.stringify(response), {
        headers: { "Content-Type": "application/json" },
      }));
    } catch (e) {
      return withCORS(new Response(JSON.stringify({
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
      }), { status: 400, headers: { "Content-Type": "application/json" } }));
    }
  },
};
