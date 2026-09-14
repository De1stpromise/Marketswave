// The catalog expansion source (2026-09-14) — the user's "CURATED LISTS BY REGION AND TYPE",
// transcribed entry for entry with the instrument's REAL name, a one-line factual
// description of what it holds/does, and the minimum bracket the brief specified. Nothing
// here is a performance claim, a rating, or anything not verifiable from the instrument.
//
// Consumed by supabase-seed-market-catalog.js --source ./catalog-source-2026-09-14.js.
// Every entry is still VERIFIED TO PRICE through the real pick step before creation, so
// this file decides what to attempt, never what exists.
//
// MINIMUMS (from the brief): $100 — large-cap US stocks, broad and major sector ETFs,
// major crypto. $500 — leveraged/inverse, thematic and single-country funds, smaller-cap
// alts. Boundary calls are flagged with `bracketNote` and reported by the seeder.
//
// EUROPEAN NAMES carry `home` — the home-exchange listing in Finnhub's symbol form — which
// the seeder tries FIRST; where the free tier does not resolve it, the US-listed ADR/direct
// listing (`symbol`) is created instead with the substitution recorded on the product
// (extended description). `adrKind` states which kind of US listing the symbol is.
//
// ORDER matters: the seeder runs sections in the brief's own order a → e.

'use strict';

const S = (symbol, name, holds, o = {}) => Object.assign({ kind: 'stock', symbol, source: 'finnhub', providerId: null, name, holds, riskTier: 'balanced', minimum: 100, investmentType: 'Stock' }, o);
const E = (symbol, name, holds, o = {}) => Object.assign({ kind: 'etf', symbol, source: 'finnhub', providerId: null, name, holds, riskTier: 'balanced', minimum: 100, investmentType: 'ETF' }, o);
const C = (symbol, providerId, name, holds, o = {}) => Object.assign({ kind: 'crypto', symbol, source: 'coingecko', providerId, name, holds, riskTier: 'aggressive', minimum: 100, investmentType: 'Digital Asset' }, o);
const AGG = { riskTier: 'aggressive' };
const CON = { riskTier: 'conservative' };
const M500 = { minimum: 500, riskTier: 'aggressive' };

// ---------------------------------------------------------------------------------------
// a. US STOCKS — 96, directly listed, $100
// ---------------------------------------------------------------------------------------
const US_STOCKS = [
  S('NVDA', 'NVIDIA Corporation', 'Designs graphics processors and accelerated-computing platforms for gaming, data centres and AI.'),
  S('AAPL', 'Apple Inc.', 'Consumer electronics (iPhone, Mac, iPad), wearables, and software and services.'),
  S('GOOGL', 'Alphabet Inc. (Class A)', 'Parent of Google: search, advertising, YouTube, Android and Google Cloud.'),
  S('MSFT', 'Microsoft Corporation', 'Software (Windows, Office), Azure cloud infrastructure, LinkedIn and gaming.'),
  S('AMZN', 'Amazon.com, Inc.', 'Online retail and marketplace, Amazon Web Services cloud, advertising and logistics.'),
  S('AVGO', 'Broadcom Inc.', 'Semiconductors for networking, broadband and wireless, plus infrastructure software (VMware).'),
  S('META', 'Meta Platforms, Inc.', 'Facebook, Instagram, WhatsApp and Messenger, funded mainly by advertising.'),
  S('TSLA', 'Tesla, Inc.', 'Electric vehicles, battery energy storage and solar products.', AGG),
  S('MU', 'Micron Technology, Inc.', 'Memory and storage semiconductors: DRAM and NAND flash.', AGG),
  S('BRK.B', 'Berkshire Hathaway Inc. (Class B)', 'Diversified holding company: insurance, railroads, utilities, energy and a large equity portfolio.'),
  S('LLY', 'Eli Lilly and Company', 'Pharmaceuticals, including diabetes, obesity, oncology and immunology medicines.'),
  S('JPM', 'JPMorgan Chase & Co.', 'Consumer and commercial banking, investment banking, asset and wealth management.'),
  S('WMT', 'Walmart Inc.', 'Discount retail stores and e-commerce in the US and internationally.'),
  S('AMD', 'Advanced Micro Devices, Inc.', 'CPUs, GPUs and adaptive computing chips for PCs, servers and embedded systems.', AGG),
  S('V', 'Visa Inc.', 'Global payments network processing card transactions between consumers, merchants and banks.'),
  S('XOM', 'Exxon Mobil Corporation', 'Integrated oil and gas: exploration, production, refining and chemicals.'),
  S('JNJ', 'Johnson & Johnson', 'Pharmaceuticals and medical devices.'),
  S('INTC', 'Intel Corporation', 'Microprocessors and semiconductor manufacturing (foundry services).', AGG),
  S('MA', 'Mastercard Incorporated', 'Global payments network for card and digital transactions.'),
  S('ABBV', 'AbbVie Inc.', 'Biopharmaceuticals in immunology, oncology, neuroscience and aesthetics.'),
  S('CSCO', 'Cisco Systems, Inc.', 'Networking hardware, security and collaboration software.'),
  S('COST', 'Costco Wholesale Corporation', 'Membership warehouse retail in the US and internationally.'),
  S('HD', 'The Home Depot, Inc.', 'Home improvement retail stores.'),
  S('NFLX', 'Netflix, Inc.', 'Subscription video streaming service.'),
  S('PG', 'The Procter & Gamble Company', 'Consumer goods: household, personal care and health products.'),
  S('KO', 'The Coca-Cola Company', 'Non-alcoholic beverage brands sold worldwide.'),
  S('CAT', 'Caterpillar Inc.', 'Construction and mining equipment, engines and industrial turbines.'),
  S('MRK', 'Merck & Co., Inc.', 'Pharmaceuticals and vaccines, including oncology and animal health.'),
  S('UNH', 'UnitedHealth Group Incorporated', 'Health insurance (UnitedHealthcare) and health services (Optum).'),
  S('CVX', 'Chevron Corporation', 'Integrated oil and gas: upstream production, refining and chemicals.'),
  S('TMO', 'Thermo Fisher Scientific Inc.', 'Laboratory instruments, reagents, consumables and life-science services.'),
  S('IBM', 'International Business Machines Corporation', 'Hybrid cloud, AI software, consulting and mainframe infrastructure.'),
  S('AXP', 'American Express Company', 'Charge and credit cards, payments network and travel services.'),
  S('LIN', 'Linde plc', 'Industrial gases and engineering.'),
  S('CRM', 'Salesforce, Inc.', 'Cloud customer-relationship-management software.'),
  S('PEP', 'PepsiCo, Inc.', 'Snacks (Frito-Lay, Quaker) and beverages (Pepsi, Gatorade).'),
  S('ABT', 'Abbott Laboratories', 'Medical devices, diagnostics, nutrition and branded generic medicines.'),
  S('ACN', 'Accenture plc', 'IT consulting, technology services and outsourcing.'),
  S('MCD', "McDonald's Corporation", 'Quick-service restaurant franchisor and operator.'),
  S('DIS', 'The Walt Disney Company', 'Media networks, streaming (Disney+), film studios and theme parks.'),
  S('QCOM', 'QUALCOMM Incorporated', 'Wireless chips and technology licensing (Snapdragon, 5G modems).'),
  S('TXN', 'Texas Instruments Incorporated', 'Analog and embedded semiconductors.'),
  S('AMAT', 'Applied Materials, Inc.', 'Semiconductor and display manufacturing equipment.', AGG),
  S('LRCX', 'Lam Research Corporation', 'Wafer-fabrication equipment for etch and deposition.', AGG),
  S('KLAC', 'KLA Corporation', 'Process control and yield-management equipment for chip manufacturing.', AGG),
  S('ADBE', 'Adobe Inc.', 'Creative, document and marketing software (Photoshop, Acrobat, Experience Cloud).'),
  S('ISRG', 'Intuitive Surgical, Inc.', 'Robotic-assisted surgical systems (da Vinci).'),
  S('NOW', 'ServiceNow, Inc.', 'Cloud workflow-automation software for enterprises.'),
  S('BKNG', 'Booking Holdings Inc.', 'Online travel booking (Booking.com, Priceline, Kayak, Agoda).'),
  S('UBER', 'Uber Technologies, Inc.', 'Ride-hailing, food delivery and freight platform.', AGG),
  S('PLTR', 'Palantir Technologies Inc.', 'Data-integration and analytics software for government and commercial customers.', AGG),
  S('GE', 'GE Aerospace', 'Jet engines and aerospace systems for commercial and military aircraft.'),
  S('GEV', 'GE Vernova Inc.', 'Power generation, wind turbines and grid electrification equipment.'),
  S('RTX', 'RTX Corporation', 'Aerospace and defence: aircraft engines (Pratt & Whitney), avionics, missiles and radar.'),
  S('NEE', 'NextEra Energy, Inc.', 'Electric utility (Florida Power & Light) and renewable-energy generation.'),
  S('BLK', 'BlackRock, Inc.', 'Asset management, including the iShares ETF range.'),
  S('MS', 'Morgan Stanley', 'Investment banking, wealth management and investment management.'),
  S('GS', 'The Goldman Sachs Group, Inc.', 'Investment banking, trading, asset and wealth management.'),
  S('BAC', 'Bank of America Corporation', 'Consumer and commercial banking, wealth management and investment banking.'),
  S('WFC', 'Wells Fargo & Company', 'Consumer and commercial banking, mortgages and wealth management.'),
  S('C', 'Citigroup Inc.', 'Global banking: treasury and trade services, markets, cards and wealth management.'),
  S('SPGI', 'S&P Global Inc.', 'Credit ratings, market indices (S&P 500), data and analytics.'),
  S('MCO', "Moody's Corporation", 'Credit ratings and risk-analytics data.'),
  S('INTU', 'Intuit Inc.', 'Financial software: TurboTax, QuickBooks, Credit Karma and Mailchimp.'),
  S('ADP', 'Automatic Data Processing, Inc.', 'Payroll and human-capital-management services.'),
  S('PGR', 'The Progressive Corporation', 'Auto, home and commercial insurance.'),
  S('CB', 'Chubb Limited', 'Property and casualty insurance and reinsurance.'),
  S('MMC', 'Marsh & McLennan Companies, Inc.', 'Insurance broking (Marsh), reinsurance and consulting (Mercer, Oliver Wyman).'),
  S('LOW', "Lowe's Companies, Inc.", 'Home improvement retail stores.'),
  S('TJX', 'The TJX Companies, Inc.', 'Off-price apparel and home retail (T.J. Maxx, Marshalls, HomeGoods).'),
  S('SBUX', 'Starbucks Corporation', 'Coffeehouse chain and packaged coffee.'),
  S('NKE', 'NIKE, Inc.', 'Athletic footwear, apparel and equipment.'),
  S('BA', 'The Boeing Company', 'Commercial aircraft, defence, space and services.', AGG),
  S('LMT', 'Lockheed Martin Corporation', 'Defence and aerospace: aircraft, missiles, space systems.'),
  S('HON', 'Honeywell International Inc.', 'Aerospace systems, building automation, industrial materials and safety products.'),
  S('UNP', 'Union Pacific Corporation', 'Freight railroad across the western United States.'),
  S('DE', 'Deere & Company', 'Agricultural, construction and forestry machinery.'),
  S('MMM', '3M Company', 'Industrial, safety and consumer products.'),
  S('PFE', 'Pfizer Inc.', 'Pharmaceuticals and vaccines.'),
  S('AMGN', 'Amgen Inc.', 'Biotechnology medicines for oncology, cardiovascular, bone and inflammatory disease.'),
  S('GILD', 'Gilead Sciences, Inc.', 'Antiviral and oncology medicines, including HIV and hepatitis treatments.'),
  S('REGN', 'Regeneron Pharmaceuticals, Inc.', 'Biotechnology medicines (Eylea, Dupixent) and antibody research.'),
  S('VRTX', 'Vertex Pharmaceuticals Incorporated', 'Medicines for cystic fibrosis and other serious diseases.'),
  S('DHR', 'Danaher Corporation', 'Life-sciences tools, diagnostics and biotechnology equipment.'),
  S('SYK', 'Stryker Corporation', 'Medical devices: orthopaedics, surgical equipment and neurotechnology.'),
  S('MDT', 'Medtronic plc', 'Medical devices: cardiovascular, diabetes, surgical and neuroscience.'),
  S('CMCSA', 'Comcast Corporation', 'Cable broadband, NBCUniversal media and theme parks.'),
  S('T', 'AT&T Inc.', 'Wireless and fibre telecommunications in the United States.'),
  S('VZ', 'Verizon Communications Inc.', 'Wireless and broadband telecommunications in the United States.'),
  S('ORCL', 'Oracle Corporation', 'Database software, enterprise applications and cloud infrastructure.'),
  S('SNPS', 'Synopsys, Inc.', 'Electronic design automation software and semiconductor IP.'),
  S('CDNS', 'Cadence Design Systems, Inc.', 'Electronic design automation software for chips and systems.'),
  S('SNOW', 'Snowflake Inc.', 'Cloud data platform for storage, analytics and sharing.', AGG),
  S('CRWD', 'CrowdStrike Holdings, Inc.', 'Cloud-delivered endpoint and cybersecurity platform.', AGG),
  S('PANW', 'Palo Alto Networks, Inc.', 'Network, cloud and security-operations cybersecurity products.'),
  S('ANET', 'Arista Networks, Inc.', 'High-speed networking switches and software for data centres.', AGG),
  S('EQIX', 'Equinix, Inc.', 'Data-centre real estate investment trust operating interconnection facilities worldwide.'),
  S('AMT', 'American Tower Corporation', 'Real estate investment trust owning wireless communications towers.'),
  S('PLD', 'Prologis, Inc.', 'Real estate investment trust owning logistics and warehouse property.'),
  S('BX', 'Blackstone Inc.', 'Alternative asset manager: private equity, real estate, credit and hedge-fund solutions.'),
  S('SCHW', 'The Charles Schwab Corporation', 'Brokerage, banking and wealth-management services.')
];

// ---------------------------------------------------------------------------------------
// a. US ETFs — 50 at $100; GDX / ARKK / DBC at $500. TQQQ excluded (see the seeder report).
// ---------------------------------------------------------------------------------------
const US_ETFS = [
  E('VOO', 'Vanguard S&P 500 ETF', 'Tracks the S&P 500: 500 large-cap US companies weighted by market capitalisation.'),
  E('IVV', 'iShares Core S&P 500 ETF', 'Tracks the S&P 500 index.'),
  E('SPY', 'SPDR S&P 500 ETF Trust', 'Tracks the S&P 500 index: 500 large-cap US companies weighted by market capitalisation.'),
  E('VTI', 'Vanguard Total Stock Market ETF', 'Tracks the CRSP US Total Market index: the whole investable US equity market.'),
  E('QQQ', 'Invesco QQQ Trust', 'Tracks the Nasdaq-100: the 100 largest non-financial companies listed on the Nasdaq.'),
  E('VEA', 'Vanguard FTSE Developed Markets ETF', 'Large, mid and small-cap companies in developed markets outside the US.'),
  E('VUG', 'Vanguard Growth ETF', 'Tracks the CRSP US Large Cap Growth index.'),
  E('VTV', 'Vanguard Value ETF', 'Tracks the CRSP US Large Cap Value index.'),
  E('IEFA', 'iShares Core MSCI EAFE ETF', 'Large, mid and small-cap companies in developed markets in Europe, Australasia and the Far East.'),
  E('BND', 'Vanguard Total Bond Market ETF', 'Tracks the Bloomberg US Aggregate Float Adjusted index: US investment-grade bonds.', CON),
  E('VXUS', 'Vanguard Total International Stock ETF', 'Stocks in developed and emerging markets outside the US.'),
  E('IEMG', 'iShares Core MSCI Emerging Markets ETF', 'Large, mid and small-cap companies in emerging markets.', AGG),
  E('VGT', 'Vanguard Information Technology ETF', 'US information-technology sector companies.', AGG),
  E('AGG', 'iShares Core U.S. Aggregate Bond ETF', 'Tracks the Bloomberg US Aggregate Bond index: US investment-grade bonds.', CON),
  E('GLD', 'SPDR Gold Shares', 'Holds physical gold bullion.'),
  E('IWF', 'iShares Russell 1000 Growth ETF', 'Large and mid-cap US growth companies from the Russell 1000.'),
  E('VWO', 'Vanguard FTSE Emerging Markets ETF', 'Tracks the FTSE Emerging Markets All Cap China A Inclusion index.', AGG),
  E('IJH', 'iShares Core S&P Mid-Cap ETF', 'Tracks the S&P MidCap 400 index.'),
  E('XLK', 'Technology Select Sector SPDR Fund', 'Technology-sector companies of the S&P 500.', AGG),
  E('VIG', 'Vanguard Dividend Appreciation ETF', 'US companies with a record of growing dividends for at least ten consecutive years.'),
  E('IWM', 'iShares Russell 2000 ETF', 'Tracks the Russell 2000: about 2,000 US small-cap companies.', { riskTier: 'aggressive', bracketNote: 'a broad small-cap INDEX fund, kept at $100 as a broad ETF rather than treated as a small-cap alt' }),
  E('XLF', 'Financial Select Sector SPDR Fund', 'Financial-sector companies of the S&P 500.'),
  E('XLV', 'Health Care Select Sector SPDR Fund', 'Health-care-sector companies of the S&P 500.'),
  E('XLY', 'Consumer Discretionary Select Sector SPDR Fund', 'Consumer-discretionary-sector companies of the S&P 500.'),
  E('XLE', 'Energy Select Sector SPDR Fund', 'Energy-sector companies of the S&P 500.', AGG),
  E('XLU', 'Utilities Select Sector SPDR Fund', 'Utilities-sector companies of the S&P 500.'),
  E('XLRE', 'Real Estate Select Sector SPDR Fund', 'Real-estate-sector companies of the S&P 500, mainly REITs.'),
  E('TLT', 'iShares 20+ Year Treasury Bond ETF', 'US Treasury bonds with more than 20 years to maturity.', CON),
  E('IEF', 'iShares 7-10 Year Treasury Bond ETF', 'US Treasury bonds with 7 to 10 years to maturity.', CON),
  E('VGIT', 'Vanguard Intermediate-Term Treasury ETF', 'US Treasury bonds with 3 to 10 years to maturity.', CON),
  E('SHY', 'iShares 1-3 Year Treasury Bond ETF', 'US Treasury bonds with 1 to 3 years to maturity.', CON),
  E('BIL', 'SPDR Bloomberg 1-3 Month T-Bill ETF', 'US Treasury bills with 1 to 3 months to maturity.', CON),
  E('SGOV', 'iShares 0-3 Month Treasury Bond ETF', 'US Treasury bills with 0 to 3 months to maturity.', CON),
  E('GOVT', 'iShares U.S. Treasury Bond ETF', 'US Treasury bonds across the maturity spectrum, 1 to 30 years.', CON),
  E('RSP', 'Invesco S&P 500 Equal Weight ETF', 'The S&P 500 with every constituent equally weighted.'),
  E('VB', 'Vanguard Small-Cap ETF', 'Tracks the CRSP US Small Cap index.', { riskTier: 'aggressive', bracketNote: 'a broad small-cap INDEX fund, kept at $100 as a broad ETF' }),
  E('IJR', 'iShares Core S&P Small-Cap ETF', 'Tracks the S&P SmallCap 600 index.', { riskTier: 'aggressive', bracketNote: 'a broad small-cap INDEX fund, kept at $100 as a broad ETF' }),
  E('VO', 'Vanguard Mid-Cap ETF', 'Tracks the CRSP US Mid Cap index.'),
  E('SCHB', 'Schwab U.S. Broad Market ETF', 'Tracks the Dow Jones U.S. Broad Stock Market index: about 2,500 US companies.'),
  E('SPLG', 'SPDR Portfolio S&P 500 ETF', 'Tracks the S&P 500 index.'),
  E('SCHD', 'Schwab U.S. Dividend Equity ETF', 'Tracks the Dow Jones U.S. Dividend 100 index: US companies with sustained dividend payments.'),
  E('VYM', 'Vanguard High Dividend Yield ETF', 'US companies with above-average dividend yields, excluding REITs.'),
  E('BNDX', 'Vanguard Total International Bond ETF', 'Investment-grade bonds outside the US, hedged to the US dollar.', CON),
  E('EMB', 'iShares J.P. Morgan USD Emerging Markets Bond ETF', 'US-dollar-denominated sovereign and quasi-sovereign bonds of emerging markets.'),
  E('QUAL', 'iShares MSCI USA Quality Factor ETF', 'US large and mid-cap companies screened for return on equity, earnings stability and low leverage.'),
  E('MTUM', 'iShares MSCI USA Momentum Factor ETF', 'US large and mid-cap companies screened for recent price momentum.'),
  E('VLUE', 'iShares MSCI USA Value Factor ETF', 'US large and mid-cap companies screened for value characteristics.'),
  E('JEPI', 'JPMorgan Equity Premium Income ETF', 'US large-cap stocks with an equity-linked-note overlay that sells call options for income.'),
  E('IGF', 'iShares Global Infrastructure ETF', 'Infrastructure companies worldwide: utilities, transportation and energy.'),
  E('ICLN', 'iShares Global Clean Energy ETF', 'Clean-energy companies worldwide: solar, wind and renewable producers.', { riskTier: 'aggressive', bracketNote: 'listed at $100 in the brief; a thematic fund by the $500 definition — kept at $100 as listed, flagged' }),
  E('GDX', 'VanEck Gold Miners ETF', 'Gold-mining companies worldwide.', M500),
  E('ARKK', 'ARK Innovation ETF', 'Actively managed, concentrated portfolio of companies ARK deems disruptive innovators.', M500),
  E('DBC', 'Invesco DB Commodity Index Tracking Fund', 'Futures contracts on a basket of energy, metals and agricultural commodities.', M500)
];

// ---------------------------------------------------------------------------------------
// b. US-LISTED EUROPE AND MIDDLE EAST ETFs
// ---------------------------------------------------------------------------------------
const EU_ME_ETFS = [
  E('VGK', 'Vanguard FTSE Europe ETF', 'Tracks the FTSE Developed Europe All Cap index.'),
  E('EZU', 'iShares MSCI Eurozone ETF', 'Large and mid-cap companies in eurozone countries.'),
  E('BBEU', 'JPMorgan BetaBuilders Europe ETF', 'Large and mid-cap companies in developed Europe.'),
  E('IEUR', 'iShares Core MSCI Europe ETF', 'Large, mid and small-cap companies in developed Europe.'),
  E('FEZ', 'SPDR EURO STOXX 50 ETF', 'Tracks the EURO STOXX 50: 50 large eurozone companies.'),
  E('EUFN', 'iShares MSCI Europe Financials ETF', 'Financial-sector companies in developed Europe.', AGG),
  E('HEDJ', 'WisdomTree Europe Hedged Equity Fund', 'Dividend-paying eurozone exporters, hedged against the euro.'),
  E('IEV', 'iShares Europe ETF', 'Tracks the S&P Europe 350: large companies across 16 European markets.'),
  E('DBEU', 'Xtrackers MSCI Europe Hedged Equity ETF', 'Developed-Europe large and mid-cap companies, currency-hedged to the US dollar.'),
  E('SPEU', 'SPDR Portfolio Europe ETF', 'Tracks the STOXX Europe Total Market index.'),
  E('HEZU', 'iShares Currency Hedged MSCI Eurozone ETF', 'Eurozone large and mid-cap companies, hedged against the euro.'),
  E('FEP', 'First Trust Europe AlphaDEX Fund', 'European companies selected by the AlphaDEX growth and value screening methodology.', AGG),
  E('IEUS', 'iShares MSCI Europe Small-Cap ETF', 'Small-cap companies in developed Europe.', AGG),
  E('FDD', 'First Trust STOXX European Select Dividend Index Fund', 'High-dividend-yield companies from the STOXX Europe 600.'),
  E('EUAD', 'Select STOXX Europe Aerospace & Defense ETF', 'European aerospace and defence companies.', { riskTier: 'aggressive', bracketNote: 'a sector-thematic fund; listed at $100 in the brief, kept at $100, flagged' }),
  E('EWU', 'iShares MSCI United Kingdom ETF', 'Large and mid-cap companies in the United Kingdom.', M500),
  E('EWG', 'iShares MSCI Germany ETF', 'Large and mid-cap companies in Germany.', M500),
  E('EWL', 'iShares MSCI Switzerland ETF', 'Large and mid-cap companies in Switzerland.', M500),
  E('EWP', 'iShares MSCI Spain ETF', 'Large and mid-cap companies in Spain.', M500),
  E('EWI', 'iShares MSCI Italy ETF', 'Large and mid-cap companies in Italy.', M500),
  E('EWN', 'iShares MSCI Netherlands ETF', 'Large and mid-cap companies in the Netherlands.', M500),
  E('EWD', 'iShares MSCI Sweden ETF', 'Large and mid-cap companies in Sweden.', M500),
  E('KSA', 'iShares MSCI Saudi Arabia ETF', 'Large and mid-cap companies in Saudi Arabia.', M500),
  E('UAE', 'iShares MSCI UAE ETF', 'Large, mid and small-cap companies in the United Arab Emirates.', M500),
  E('QAT', 'iShares MSCI Qatar ETF', 'Large, mid and small-cap companies in Qatar.', M500),
  E('KWT', 'iShares MSCI Kuwait ETF', 'Large, mid and small-cap companies in Kuwait.', M500),
  E('EIS', 'iShares MSCI Israel ETF', 'Large, mid and small-cap companies in Israel.', M500),
  E('ISRA', 'VanEck Israel ETF', 'Israeli companies listed in Israel and abroad.', M500),
  E('ITEQ', 'BlueStar Israel Technology ETF', 'Israeli technology companies listed in Israel and abroad.', M500),
  E('IZRL', 'ARK Israel Innovative Technology ETF', 'Israeli companies in disruptive-innovation industries.', M500),
  E('FLSA', 'Franklin FTSE Saudi Arabia ETF', 'Large and mid-cap companies in Saudi Arabia.', M500),
  E('GULF', 'WisdomTree Middle East Dividend Fund', 'Dividend-paying companies in the Gulf Cooperation Council states.', M500),
  E('TUR', 'iShares MSCI Turkey ETF', 'Large, mid and small-cap companies in Turkey.', M500)
];

// ---------------------------------------------------------------------------------------
// c. EUROPEAN STOCKS — home listing tried first (Finnhub symbol form), US listing created
//    where the home listing does not resolve, substitution recorded on the product.
// ---------------------------------------------------------------------------------------
const EU = (symbol, name, holds, home, homeExchange, adrKind, o = {}) => S(symbol, name, holds, Object.assign({ home, homeExchange, adrKind }, o));
const EU_STOCKS_TIER1 = [
  EU('ASML', 'ASML Holding N.V.', 'Photolithography systems for semiconductor manufacturing.', 'ASML.AS', 'Euronext Amsterdam', 'NASDAQ direct listing'),
  EU('NVO', 'Novo Nordisk A/S', 'Diabetes and obesity medicines (insulin, GLP-1 therapies).', 'NOVO-B.CO', 'Nasdaq Copenhagen', 'NYSE ADR'),
  EU('AZN', 'AstraZeneca PLC', 'Pharmaceuticals in oncology, cardiovascular, respiratory and rare disease.', 'AZN.L', 'London Stock Exchange', 'NASDAQ ADR'),
  EU('SHEL', 'Shell plc', 'Integrated oil, gas, LNG and energy products.', 'SHEL.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('SAP', 'SAP SE', 'Enterprise resource planning and business software.', 'SAP.DE', 'Xetra (Frankfurt)', 'NYSE ADR'),
  EU('UL', 'Unilever PLC', 'Consumer goods: food, home care, beauty and personal care brands.', 'ULVR.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('HSBC', 'HSBC Holdings plc', 'International banking with a focus on Asia and the UK.', 'HSBA.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('UBS', 'UBS Group AG', 'Wealth management, asset management and investment banking.', 'UBSG.SW', 'SIX Swiss Exchange', 'NYSE listing'),
  EU('SAN', 'Banco Santander, S.A.', 'Retail and commercial banking in Europe and the Americas.', 'SAN.MC', 'Bolsa de Madrid', 'NYSE ADR'),
  EU('BBVA', 'Banco Bilbao Vizcaya Argentaria, S.A.', 'Retail and commercial banking in Spain, Mexico, Turkey and South America.', 'BBVA.MC', 'Bolsa de Madrid', 'NYSE ADR'),
  EU('RIO', 'Rio Tinto Group', 'Mining: iron ore, aluminium, copper and minerals.', 'RIO.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('BP', 'BP p.l.c.', 'Integrated oil, gas and energy products.', 'BP.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('DEO', 'Diageo plc', 'Spirits and beer brands sold worldwide.', 'DGE.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('GSK', 'GSK plc', 'Pharmaceuticals and vaccines.', 'GSK.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('BTI', 'British American Tobacco p.l.c.', 'Tobacco and nicotine products.', 'BATS.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('STLA', 'Stellantis N.V.', 'Automobiles: Peugeot, Fiat, Jeep, Chrysler, Opel and other brands.', 'STLAM.MI', 'Borsa Italiana', 'NYSE listing'),
  EU('ERIC', 'Telefonaktiebolaget LM Ericsson', 'Mobile network equipment and services (5G).', 'ERIC-B.ST', 'Nasdaq Stockholm', 'NASDAQ ADR'),
  EU('NOK', 'Nokia Oyj', 'Network infrastructure and technology licensing.', 'NOKIA.HE', 'Nasdaq Helsinki', 'NYSE ADR'),
  EU('EQNR', 'Equinor ASA', 'Oil, gas and renewable energy, majority state-owned.', 'EQNR.OL', 'Oslo Børs', 'NYSE ADR'),
  EU('DB', 'Deutsche Bank AG', 'Corporate and investment banking, private banking and asset management.', 'DBK.DE', 'Xetra (Frankfurt)', 'NYSE listing'),
  EU('ING', 'ING Groep N.V.', 'Retail and wholesale banking in Europe.', 'INGA.AS', 'Euronext Amsterdam', 'NYSE ADR'),
  EU('PHG', 'Koninklijke Philips N.V.', 'Health technology: imaging, patient monitoring and personal health.', 'PHIA.AS', 'Euronext Amsterdam', 'NYSE listing'),
  EU('BUD', 'Anheuser-Busch InBev SA/NV', 'Beer brands including Budweiser, Stella Artois and Corona.', 'ABI.BR', 'Euronext Brussels', 'NYSE ADR'),
  EU('NVS', 'Novartis AG', 'Pharmaceuticals.', 'NOVN.SW', 'SIX Swiss Exchange', 'NYSE ADR'),
  EU('TTE', 'TotalEnergies SE', 'Integrated oil, gas, LNG, renewables and electricity.', 'TTE.PA', 'Euronext Paris', 'NYSE ADR'),
  EU('SNY', 'Sanofi', 'Pharmaceuticals and vaccines.', 'SAN.PA', 'Euronext Paris', 'NASDAQ ADR'),
  EU('RELX', 'RELX PLC', 'Information analytics and decision tools for science, legal, risk and exhibitions.', 'REL.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('NGG', 'National Grid plc', 'Electricity and gas transmission networks in the UK and US.', 'NG.L', 'London Stock Exchange', 'NYSE ADR'),
  EU('ORAN', 'Orange S.A.', 'Telecommunications in France, Europe and Africa.', 'ORA.PA', 'Euronext Paris', 'NYSE ADR'),
  EU('STM', 'STMicroelectronics N.V.', 'Semiconductors for automotive, industrial and personal electronics.', 'STMPA.PA', 'Euronext Paris', 'NYSE listing'),
  EU('FER', 'Ferrovial SE', 'Toll roads, airports and construction.', 'FER.AS', 'Euronext Amsterdam', 'NASDAQ listing'),
  EU('E', 'Eni S.p.A.', 'Integrated oil, gas and energy, part state-owned.', 'ENI.MI', 'Borsa Italiana', 'NYSE ADR')
];
const EU_STOCKS_TIER2 = [
  EU('RHHBY', 'Roche Holding AG', 'Pharmaceuticals and diagnostics.', 'ROG.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('NSRGY', 'Nestlé S.A.', 'Packaged food, beverages, coffee, pet care and nutrition.', 'NESN.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('LVMUY', 'LVMH Moët Hennessy Louis Vuitton SE', 'Luxury goods: fashion, leather goods, wines and spirits, watches and jewellery.', 'MC.PA', 'Euronext Paris', 'OTC ADR'),
  EU('LRLCY', "L'Oréal S.A.", 'Cosmetics and beauty products.', 'OR.PA', 'Euronext Paris', 'OTC ADR'),
  EU('SIEGY', 'Siemens AG', 'Industrial automation, smart infrastructure, mobility and healthcare technology.', 'SIE.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('HESAY', 'Hermès International', 'Luxury leather goods, silk, ready-to-wear and accessories.', 'RMS.PA', 'Euronext Paris', 'OTC ADR'),
  EU('ALIZY', 'Allianz SE', 'Insurance and asset management (PIMCO, Allianz Global Investors).', 'ALV.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('SBGSY', 'Schneider Electric SE', 'Energy management and industrial automation equipment.', 'SU.PA', 'Euronext Paris', 'OTC ADR'),
  EU('EADSY', 'Airbus SE', 'Commercial aircraft, helicopters, defence and space.', 'AIR.PA', 'Euronext Paris', 'OTC ADR'),
  EU('PROSY', 'Prosus N.V.', 'Consumer internet investments, including a stake in Tencent.', 'PRX.AS', 'Euronext Amsterdam', 'OTC ADR'),
  EU('IDEXY', 'Industria de Diseño Textil, S.A. (Inditex)', 'Fashion retail: Zara, Massimo Dutti, Bershka and other brands.', 'ITX.MC', 'Bolsa de Madrid', 'OTC ADR'),
  EU('SAFRY', 'Safran S.A.', 'Aircraft engines, equipment and interiors.', 'SAF.PA', 'Euronext Paris', 'OTC ADR'),
  EU('IBDRY', 'Iberdrola, S.A.', 'Electricity generation and networks, with a large renewables fleet.', 'IBE.MC', 'Bolsa de Madrid', 'OTC ADR'),
  EU('DTEGY', 'Deutsche Telekom AG', 'Telecommunications in Germany, Europe and the US (T-Mobile US).', 'DTE.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('BNPQY', 'BNP Paribas S.A.', 'Retail, corporate and investment banking.', 'BNP.PA', 'Euronext Paris', 'OTC ADR'),
  EU('AXAHY', 'AXA S.A.', 'Insurance and asset management.', 'CS.PA', 'Euronext Paris', 'OTC ADR'),
  EU('AIQUY', 'Air Liquide S.A.', 'Industrial and medical gases.', 'AI.PA', 'Euronext Paris', 'OTC ADR'),
  EU('ABBNY', 'ABB Ltd', 'Electrification, motion, process automation and robotics.', 'ABBN.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('ENLAY', 'Enel S.p.A.', 'Electricity generation, distribution and renewables.', 'ENEL.MI', 'Borsa Italiana', 'OTC ADR'),
  EU('VCISY', 'Vinci S.A.', 'Concessions (airports, motorways) and construction.', 'DG.PA', 'Euronext Paris', 'OTC ADR'),
  EU('ZURVY', 'Zurich Insurance Group AG', 'Property and casualty and life insurance.', 'ZURN.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('ISNPY', 'Intesa Sanpaolo S.p.A.', 'Retail and corporate banking in Italy.', 'ISP.MI', 'Borsa Italiana', 'OTC ADR'),
  EU('UNCRY', 'UniCredit S.p.A.', 'Commercial banking in Italy, Germany and central and eastern Europe.', 'UCG.MI', 'Borsa Italiana', 'OTC ADR'),
  EU('RYCEY', 'Rolls-Royce Holdings plc', 'Aircraft engines, defence propulsion and power systems.', 'RR.L', 'London Stock Exchange', 'OTC ADR'),
  EU('SMNEY', 'Siemens Energy AG', 'Power generation, grid technology and wind turbines (Siemens Gamesa).', 'ENR.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('IFNNY', 'Infineon Technologies AG', 'Power semiconductors and microcontrollers for automotive and industrial use.', 'IFX.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('ADYEY', 'Adyen N.V.', 'Payment processing platform for merchants.', 'ADYEN.AS', 'Euronext Amsterdam', 'OTC ADR'),
  EU('HEINY', 'Heineken N.V.', 'Beer and cider brands sold worldwide.', 'HEIA.AS', 'Euronext Amsterdam', 'OTC ADR'),
  EU('ADRNY', 'Koninklijke Ahold Delhaize N.V.', 'Supermarkets and online grocery in Europe and the US.', 'AD.AS', 'Euronext Amsterdam', 'OTC ADR'),
  EU('ESLOY', 'EssilorLuxottica SA', 'Eyewear: lenses, frames and retail (Ray-Ban, Oakley, Sunglass Hut).', 'EL.PA', 'Euronext Paris', 'OTC ADR'),
  EU('PRNDY', 'Pernod Ricard SA', 'Wines and spirits.', 'RI.PA', 'Euronext Paris', 'OTC ADR'),
  EU('DANOY', 'Danone S.A.', 'Dairy, plant-based, water and specialised nutrition products.', 'BN.PA', 'Euronext Paris', 'OTC ADR'),
  EU('ENGIY', 'Engie SA', 'Electricity, gas and energy services.', 'ENGI.PA', 'Euronext Paris', 'OTC ADR'),
  EU('PUBGY', 'Publicis Groupe S.A.', 'Advertising, media and marketing services.', 'PUB.PA', 'Euronext Paris', 'OTC ADR'),
  EU('VWAGY', 'Volkswagen AG', 'Automobiles: Volkswagen, Audi, Porsche, Škoda, SEAT and commercial vehicles.', 'VOW3.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('BMWYY', 'Bayerische Motoren Werke AG', 'Automobiles and motorcycles: BMW, MINI, Rolls-Royce Motor Cars.', 'BMW.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('MBGYY', 'Mercedes-Benz Group AG', 'Passenger cars and vans.', 'MBG.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('BASFY', 'BASF SE', 'Chemicals: materials, industrial solutions, nutrition and agricultural products.', 'BAS.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('BAYRY', 'Bayer AG', 'Pharmaceuticals, consumer health and crop science.', 'BAYN.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('DHLGY', 'DHL Group', 'Parcel, express and freight logistics.', 'DHL.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('MURGY', 'Münchener Rückversicherungs-Gesellschaft AG (Munich Re)', 'Reinsurance and primary insurance (ERGO).', 'MUV2.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('CRZBY', 'Commerzbank AG', 'Corporate and retail banking in Germany.', 'CBK.DE', 'Xetra (Frankfurt)', 'OTC ADR'),
  EU('VLVLY', 'AB Volvo', 'Trucks, buses, construction equipment and marine engines.', 'VOLV-B.ST', 'Nasdaq Stockholm', 'OTC ADR'),
  EU('ATLKY', 'Atlas Copco AB', 'Compressors, vacuum equipment, industrial tools and power technique.', 'ATCO-A.ST', 'Nasdaq Stockholm', 'OTC ADR'),
  EU('SDVKY', 'Sandvik AB', 'Mining and rock-excavation equipment, metal-cutting tools and materials.', 'SAND.ST', 'Nasdaq Stockholm', 'OTC ADR'),
  EU('HXGBY', 'Hexagon AB', 'Sensor, software and measurement technology.', 'HEXA-B.ST', 'Nasdaq Stockholm', 'OTC ADR'),
  EU('CFRUY', 'Compagnie Financière Richemont SA', 'Luxury jewellery and watches: Cartier, Van Cleef & Arpels, IWC and others.', 'CFR.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('LZAGY', 'Lonza Group AG', 'Contract development and manufacturing for pharmaceuticals and biotech.', 'LONN.SW', 'SIX Swiss Exchange', 'OTC ADR'),
  EU('PPRUY', 'Kering SA', 'Luxury fashion and accessories: Gucci, Saint Laurent, Bottega Veneta and others.', 'KER.PA', 'Euronext Paris', 'OTC ADR'),
  EU('DASTY', 'Dassault Systèmes SE', '3D design, simulation and product-lifecycle software.', 'DSY.PA', 'Euronext Paris', 'OTC ADR'),
  EU('PRYMY', 'Prysmian S.p.A.', 'Energy and telecommunications cables.', 'PRY.MI', 'Borsa Italiana', 'OTC ADR'),
  EU('ARZGY', 'Assicurazioni Generali S.p.A.', 'Life and property and casualty insurance, asset management.', 'G.MI', 'Borsa Italiana', 'OTC ADR'),
  EU('REPYY', 'Repsol, S.A.', 'Integrated oil, gas and energy.', 'REP.MC', 'Bolsa de Madrid', 'OTC ADR'),
  EU('CAIXY', 'CaixaBank, S.A.', 'Retail banking and insurance in Spain and Portugal.', 'CABK.MC', 'Bolsa de Madrid', 'OTC ADR'),
  EU('AMADY', 'Amadeus IT Group, S.A.', 'Travel technology: airline and hotel distribution and IT systems.', 'AMS.MC', 'Bolsa de Madrid', 'OTC ADR'),
  EU('WTKWY', 'Wolters Kluwer N.V.', 'Professional information, software and services for health, tax, legal and finance.', 'WKL.AS', 'Euronext Amsterdam', 'OTC ADR'),
  EU('EXPGY', 'Experian plc', 'Credit reporting, data and analytics.', 'EXPN.L', 'London Stock Exchange', 'OTC ADR'),
  EU('DNBBY', 'DNB Bank ASA', "Norway's largest financial services group: banking, insurance and asset management.", 'DNB.OL', 'Oslo Børs', 'OTC ADR')
];

// ---------------------------------------------------------------------------------------
// d. CRYPTO — 43, $100 (stablecoins and meme coins excluded per the brief)
// ---------------------------------------------------------------------------------------
const CRYPTO = [
  C('BTC', 'bitcoin', 'Bitcoin', "The Bitcoin network's native asset."),
  C('ETH', 'ethereum', 'Ethereum', "The Ethereum network's native asset, used to pay for computation on the network."),
  C('BNB', 'binancecoin', 'BNB', 'The native asset of the BNB Chain, used for fees on the network and within the Binance ecosystem.'),
  C('XRP', 'ripple', 'XRP', 'The native asset of the XRP Ledger, a payments-focused blockchain.'),
  C('SOL', 'solana', 'Solana', "The Solana network's native asset."),
  C('TRX', 'tron', 'TRON', "The TRON network's native asset."),
  C('ADA', 'cardano', 'Cardano', "The Cardano network's native asset."),
  C('HYPE', 'hyperliquid', 'Hyperliquid', 'The native asset of the Hyperliquid layer-1, a decentralised derivatives exchange chain.'),
  C('LINK', 'chainlink', 'Chainlink', 'The token of the Chainlink oracle network.'),
  C('BCH', 'bitcoin-cash', 'Bitcoin Cash', "The Bitcoin Cash network's native asset, a 2017 fork of Bitcoin."),
  C('XLM', 'stellar', 'Stellar', "The Stellar network's native asset (lumens), a payments-focused blockchain."),
  C('LTC', 'litecoin', 'Litecoin', "The Litecoin network's native asset."),
  C('XMR', 'monero', 'Monero', "The Monero network's native asset, a privacy-focused cryptocurrency."),
  C('HBAR', 'hedera-hashgraph', 'Hedera', 'The native asset of the Hedera public network.'),
  C('AVAX', 'avalanche-2', 'Avalanche', "The Avalanche network's native asset."),
  C('SUI', 'sui', 'Sui', "The Sui network's native asset."),
  C('TON', 'the-open-network', 'Toncoin', 'The native asset of The Open Network (TON).'),
  C('DOT', 'polkadot', 'Polkadot', "The Polkadot network's native asset."),
  C('UNI', 'uniswap', 'Uniswap', 'The governance token of the Uniswap decentralised exchange protocol.'),
  C('NEAR', 'near', 'NEAR Protocol', "The NEAR network's native asset."),
  C('AAVE', 'aave', 'Aave', 'The governance token of the Aave lending protocol.'),
  C('ATOM', 'cosmos', 'Cosmos', 'The native asset of the Cosmos Hub.'),
  C('FIL', 'filecoin', 'Filecoin', 'The native asset of the Filecoin decentralised storage network.'),
  C('ICP', 'internet-computer', 'Internet Computer', 'The native asset of the Internet Computer network.'),
  C('RNDR', 'render-token', 'Render', 'The token of the Render distributed GPU rendering network.'),
  C('APT', 'aptos', 'Aptos', "The Aptos network's native asset."),
  C('ARB', 'arbitrum', 'Arbitrum', 'The governance token of the Arbitrum Ethereum layer-2 network.'),
  C('OP', 'optimism', 'Optimism', 'The governance token of the Optimism Ethereum layer-2 network.'),
  C('INJ', 'injective-protocol', 'Injective', "The Injective network's native asset."),
  C('GRT', 'the-graph', 'The Graph', 'The token of The Graph indexing protocol for blockchain data.'),
  C('ALGO', 'algorand', 'Algorand', "The Algorand network's native asset."),
  C('VET', 'vechain', 'VeChain', "The VeChainThor network's native asset."),
  C('QNT', 'quant-network', 'Quant', 'The token of the Quant Overledger interoperability network.'),
  C('STX', 'blockstack', 'Stacks', 'The native asset of the Stacks Bitcoin layer for smart contracts.'),
  C('IMX', 'immutable-x', 'Immutable', 'The token of the Immutable Ethereum layer-2 for games.'),
  C('TIA', 'celestia', 'Celestia', 'The native asset of the Celestia modular data-availability network.'),
  C('SEI', 'sei-network', 'Sei', "The Sei network's native asset."),
  C('WLD', 'worldcoin-wld', 'Worldcoin', 'The token of the World network and identity protocol.'),
  C('ONDO', 'ondo-finance', 'Ondo', 'The governance token of Ondo Finance, a tokenised real-world-assets platform.'),
  C('ENA', 'ethena', 'Ethena', 'The governance token of the Ethena synthetic-dollar protocol.'),
  C('MNT', 'mantle', 'Mantle', 'The native asset of the Mantle Ethereum layer-2 network.'),
  C('CRO', 'crypto-com-chain', 'Cronos', 'The native asset of the Cronos chain, developed by Crypto.com.'),
  C('KAS', 'kaspa', 'Kaspa', "The Kaspa network's native asset, a proof-of-work blockDAG.")
];

// ---------------------------------------------------------------------------------------
// e. MIDDLE EAST STOCKS — US-listed Israeli companies at $100 (attempted); Gulf names are
//    in the unresolvable report (home-exchange only, not reachable on the free tier).
// ---------------------------------------------------------------------------------------
const ME_STOCKS = [
  S('CHKP', 'Check Point Software Technologies Ltd.', 'Network, cloud and endpoint cybersecurity products.'),
  S('TEVA', 'Teva Pharmaceutical Industries Limited', 'Generic and speciality pharmaceuticals.'),
  S('NICE', 'NICE Ltd.', 'Cloud software for customer engagement and financial-crime compliance.'),
  S('CYBR', 'CyberArk Software Ltd.', 'Identity security and privileged-access management software.', AGG),
  S('TSEM', 'Tower Semiconductor Ltd.', 'Analog semiconductor foundry.', AGG),
  S('ESLT', 'Elbit Systems Ltd.', 'Defence electronics, aerospace and land systems.'),
  // Gulf large-caps are attempted through their Finnhub home-exchange symbols purely so the
  // report states what the free tier answered, never assumed.
  S('2222.SR', 'Saudi Arabian Oil Company (Saudi Aramco)', 'Integrated oil and gas, majority state-owned.', { attemptOnly: true, homeExchange: 'Saudi Exchange (Tadawul)' }),
  S('1120.SR', 'Al Rajhi Bank', 'Islamic banking in Saudi Arabia.', { attemptOnly: true, homeExchange: 'Saudi Exchange (Tadawul)' }),
  S('FAB.AE', 'First Abu Dhabi Bank PJSC', 'Banking in the United Arab Emirates.', { attemptOnly: true, homeExchange: 'Abu Dhabi Securities Exchange' }),
  S('QNBK.QA', 'Qatar National Bank (QPSC)', 'Banking in Qatar and the Middle East.', { attemptOnly: true, homeExchange: 'Qatar Stock Exchange' })
];

// ---------------------------------------------------------------------------------------
// Lines from the source that are NOT tickers and are not guessed at — reported as
// unresolvable by the seeder. Europe-domiciled UCITS have no US listing and are skipped.
// ---------------------------------------------------------------------------------------
const UNRESOLVABLE = [
  { line: 'TQQQ', reason: 'excluded per the brief: 3x daily leverage is a different product class from a wealth-management catalog, not a pricing bracket' },
  { line: 'IBIT / FBTC (spot Bitcoin ETFs)', reason: 'dropped per the brief: BTC is offered directly, this is the same exposure twice' },
  { line: 'GOOG', reason: 'duplicate listing of GOOGL (same company), per the brief' },
  { line: 'Europe-domiciled UCITS (all)', reason: 'no US listing, unreachable on the price feed' },
  { line: 'Gulf stocks: Aramco, Al Rajhi, FAB, QNB', reason: 'home-exchange only; attempted through their home symbols (see the ME report) and expected not to resolve on the free tier — the country ETFs (KSA, FLSA, UAE, QAT) are the route to that exposure' },
  { line: 'USDT, USDC, LEO', reason: 'stablecoins — pegged, would show 0.0% forever' },
  { line: 'PEPE, BONK, SHIB, DOGE', reason: 'meme coins — excluded deliberately' }
];

module.exports = {
  sections: [
    { key: 'a-us-stocks', label: 'a. US stocks', items: US_STOCKS },
    { key: 'a-us-etfs', label: 'a. US ETFs', items: US_ETFS },
    { key: 'b-eu-me-etfs', label: 'b. US-listed Europe and Middle East ETFs', items: EU_ME_ETFS },
    { key: 'c-eu-stocks-tier1', label: 'c. European stocks, tier 1 (major exchange)', items: EU_STOCKS_TIER1 },
    { key: 'c-eu-stocks-tier2', label: 'c. European stocks, tier 2 (OTC ADRs)', items: EU_STOCKS_TIER2 },
    { key: 'd-crypto', label: 'd. Crypto', items: CRYPTO },
    { key: 'e-me-stocks', label: 'e. Middle East stocks', items: ME_STOCKS }
  ],
  unresolvable: UNRESOLVABLE
};
