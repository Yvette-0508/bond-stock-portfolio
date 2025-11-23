const COLORS = [
    {border: '#3b82f6', background: 'rgba(59, 130, 246, 0.15)'},
    {border: '#10b981', background: 'rgba(16, 185, 129, 0.15)'},
    {border: '#f59e0b', background: 'rgba(245, 158, 11, 0.15)'},
];

let charts = {};
let currentPeriod = '1M';
let currentBenchmark = 'SPY';
let accountsData = [];

document.addEventListener('DOMContentLoaded', () => {
    initializePeriodSelector();
    loadDashboard();
    setInterval(loadDashboard, 60000);
});

function updateBenchmark(symbol) {
    currentBenchmark = symbol;
    loadPortfolioHistory();
}

function initializePeriodSelector() {
    const buttons = document.querySelectorAll('.period-btn');
    buttons.forEach(btn => {
        btn.addEventListener('click', () => {
            buttons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentPeriod = btn.dataset.period;
            loadPortfolioHistory();
        });
    });
}

async function loadDashboard() {
    await Promise.all([loadAccountSummary(), loadPortfolioHistory(), loadRiskMetrics()]);
    updateLastUpdateTime();
}

async function loadRiskMetrics() {
    try {
        const response = await fetch('/api/risk-metrics');
        const data = await response.json();
        renderAllocationChart(data.allocation);
    } catch (error) {
        console.error('Error loading risk metrics:', error);
    }
}

function renderAllocationChart(allocation) {
    const ctx = document.getElementById('allocationChart').getContext('2d');
    if (charts['allocationChart']) charts['allocationChart'].destroy();
    
    charts['allocationChart'] = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: Object.keys(allocation),
            datasets: [{
                data: Object.values(allocation),
                backgroundColor: ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#6366f1', '#94a3b8'],
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            plugins: {
                legend: {
                    position: 'right',
                    labels: { boxWidth: 12, padding: 15, font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            const val = context.parsed;
                            const total = context.dataset.data.reduce((a, b) => a + b, 0);
                            const pct = ((val / total) * 100).toFixed(1);
                            return `${context.label}: $${formatNumber(val)} (${pct}%)`;
                        }
                    }
                }
            },
            cutout: '65%'
        }
    });
}

async function loadAccountSummary() {
    try {
        const response = await fetch('/api/account-summary');
        const data = await response.json();
        document.getElementById('accountsList').innerHTML = data.map((account, index) => createAccountCard(account, index)).join('');
    } catch (error) {
        console.error('Error loading account summary:', error);
        showError('Failed to load account summary');
    }
}

function createAccountCard(account, index) {
    if (account.error) {
        return `
            <div class="account-card account-${index}">
                <div class="account-name">
                    <span class="account-indicator"></span>
                    ${account.name}
                </div>
                <div class="error">Error: ${account.error}</div>
            </div>
        `;
    }

    const change = account.day_profit_loss;
    const changePct = account.day_profit_loss_pct;
    const isPositive = change >= 0;
    const arrow = isPositive ? '↑' : '↓';
    const changeClass = isPositive ? 'positive' : 'negative';
    const sign = isPositive ? '+' : '';
    
    const isTotal = account.is_total;
    const isMarket = account.is_market;
    
    let cardClass = `account-card account-${index - 1}`;
    let nameClass = 'account-name';
    let indicatorHtml = '<span class="account-indicator"></span>';
    let metricsHtml = `
        <div class="account-metrics">
            <div class="metric-item">
                <span class="metric-label">Cash</span>
                <span class="metric-value">$${formatNumber(account.cash)}</span>
            </div>
            <div class="metric-item">
                <span class="metric-label">Positions</span>
                <span class="metric-value">${account.positions_count}</span>
            </div>
        </div>
    `;

    if (isTotal) {
        cardClass = 'account-card total-portfolio';
        nameClass = 'account-name total-name';
        indicatorHtml = '';
    } else if (isMarket) {
        cardClass = 'account-card market-card';
        nameClass = 'account-name market-name';
        indicatorHtml = '';
        metricsHtml = '';
    }

    return `
        <div class="${cardClass}">
            <div class="${nameClass}">
                ${indicatorHtml}
                ${account.name}
            </div>
            <div class="equity-value">$${formatNumber(account.equity)}</div>
            <div class="change ${changeClass}">
                ${arrow} ${sign}$${formatNumber(Math.abs(change))} (${sign}${changePct.toFixed(2)}%)
            </div>
            ${metricsHtml}
        </div>
    `;
}

async function loadPortfolioHistory() {
    try {
        const response = await fetch(`/api/portfolio-history/${currentPeriod}?benchmark=${currentBenchmark}`);
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }

        const accounts = data.accounts || data; 
        const benchmark = data.benchmark;

        accountsData = accounts;
        renderAllCharts(accounts, benchmark);
    } catch (error) {
        console.error('Error loading portfolio history:', error);
        showError('Failed to load portfolio history');
    }
}

function renderAllCharts(accounts, benchmark) {
    renderLineChart('pnlChart', accounts, 'pnl_pct', 'PnL %', false, benchmark);
    renderLineChart('equityChart', accounts, 'equity', 'Equity ($)', true, benchmark);
    renderLineChart('pnlDollarChart', accounts, 'pnl', 'PnL ($)', true);
    renderBarChart('volatilityChart', accounts, 'volatility', 'Volatility (%)');
    renderBarChart('sharpeChart', accounts, 'sharpe_ratio', 'Sharpe Ratio');
    renderBarChart('drawdownChart', accounts, 'max_drawdown', 'Max Drawdown (%)');
}

function renderLineChart(canvasId, accounts, dataKey, label, isDollar = false, benchmark = null) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (charts[canvasId]) charts[canvasId].destroy();

    const datasets = accounts.map((account, index) => {
        if (account.error || !account[dataKey] || account[dataKey].length === 0) return null;

        const color = COLORS[index % COLORS.length];
        
        return {
            label: account.name,
            data: account[dataKey],
            borderColor: color.border,
            backgroundColor: color.background,
            borderWidth: 2,
            fill: true,
            tension: 0.4,
            pointRadius: 0,
            pointHoverRadius: 5,
            pointHoverBackgroundColor: color.border,
            pointHoverBorderColor: '#ffffff',
            pointHoverBorderWidth: 2,
        };
    }).filter(dataset => dataset !== null);

    const labels = accounts.find(acc => acc.timestamps && acc.timestamps.length > 0)?.timestamps || [];

    if (benchmark && benchmark.close && benchmark.timestamps) {
        const alignedBenchmark = alignBenchmarkData(labels, benchmark);
        
        if (alignedBenchmark.length > 0) {
            let benchData = [];
            const basePrice = alignedBenchmark.find(p => p !== null) || alignedBenchmark[0];

            if (canvasId === 'pnlChart') {
                benchData = alignedBenchmark.map(p => p !== null ? ((p - basePrice) / basePrice) * 100 : null);
            } else if (canvasId === 'equityChart') {
                const firstAccount = accounts.find(acc => acc.equity && acc.equity.length > 0);
                const startingEquity = firstAccount && firstAccount.equity ? firstAccount.equity[0] : 100000;
                benchData = alignedBenchmark.map(p => p !== null ? (p / basePrice) * startingEquity : null);
            }

            datasets.push({
                label: `${benchmark.symbol || 'Benchmark'}`,
                data: benchData,
                borderColor: '#94a3b8',
                borderWidth: 2,
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0,
                tension: 0.4,
                spanGaps: true
            });
        }
    }

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: { labels: labels, datasets: datasets },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: { mode: 'index', intersect: false },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        color: '#1e293b',
                        font: { size: 12, weight: '500' },
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    padding: 12,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    titleFont: { size: 13, weight: '600' },
                    bodyFont: { size: 12 },
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (isDollar) return `${label}: $${formatNumber(value)}`;
                            return `${label}: ${value.toFixed(2)}%`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    display: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: {
                        color: '#64748b',
                        maxRotation: 0,
                        minRotation: 0,
                        font: { size: 10, maxTicksLimit: 8 },
                    },
                },
                y: {
                    display: true,
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: {
                        color: '#64748b',
                        callback: function(value) {
                            if (isDollar) return '$' + formatNumber(value);
                            return value.toFixed(1) + '%';
                        },
                        font: { size: 11 },
                    },
                },
            },
        },
    });
}

function renderBarChart(canvasId, accounts, metricKey, label) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    if (charts[canvasId]) charts[canvasId].destroy();

    const labels = accounts.map(acc => acc.name);
    const data = accounts.map(acc => acc[metricKey] || 0);
    const backgroundColors = accounts.map((_, index) => COLORS[index % COLORS.length].background);
    const borderColors = accounts.map((_, index) => COLORS[index % COLORS.length].border);

    charts[canvasId] = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: label,
                data: data,
                backgroundColor: backgroundColors,
                borderColor: borderColors,
                borderWidth: 2,
            }],
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            plugins: {
                legend: { display: false },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    padding: 12,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    callbacks: {
                        label: function(context) {
                            return `${label}: ${context.parsed.y.toFixed(2)}`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: '#64748b', font: { size: 11 } },
                },
                y: {
                    grid: { color: 'rgba(0, 0, 0, 0.05)' },
                    ticks: { color: '#64748b', font: { size: 11 } },
                },
            },
        },
    });
}

function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return parseFloat(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    document.getElementById('lastUpdate').textContent = timeString;
}

function showError(message) {
    console.error(message);
}

function alignBenchmarkData(chartLabels, benchmark) {
    if (!benchmark.timestamps || !benchmark.close) return [];
    
    const benchTimes = benchmark.timestamps.map(t => new Date(t).getTime());
    const benchPrices = benchmark.close;
    
    return chartLabels.map(label => {
        const labelTime = new Date(label).getTime();
        let closestIdx = -1;
        let minDiff = Infinity;
        
        for (let i = 0; i < benchTimes.length; i++) {
            const diff = Math.abs(labelTime - benchTimes[i]);
            if (diff < minDiff) {
                minDiff = diff;
                closestIdx = i;
            }
        }
        
        if (minDiff > 3600000) return null;
        return benchPrices[closestIdx];
    });
}
