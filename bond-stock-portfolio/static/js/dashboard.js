// Color palette for accounts
const COLORS = [
    {
        border: '#3b82f6',
        background: 'rgba(59, 130, 246, 0.15)',
    },
    {
        border: '#10b981',
        background: 'rgba(16, 185, 129, 0.15)',
    },
    {
        border: '#f59e0b',
        background: 'rgba(245, 158, 11, 0.15)',
    },
];

let charts = {};
let currentPeriod = '1M';
let accountsData = [];

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
    initializePeriodSelector();
    loadDashboard();
    
    // Auto-refresh every 60 seconds
    setInterval(loadDashboard, 60000);
});

// Period selector functionality
function initializePeriodSelector() {
    const select = document.getElementById('periodSelect');
    
    select.addEventListener('change', (e) => {
        currentPeriod = e.target.value;
        loadPortfolioHistory();
    });
}

// Load all dashboard data
async function loadDashboard() {
    await Promise.all([
        loadAccountSummary(),
        loadPortfolioHistory()
    ]);
    updateLastUpdateTime();
}

// Fetch and display account summaries in sidebar
async function loadAccountSummary() {
    try {
        const response = await fetch('/api/account-summary');
        const data = await response.json();
        
        const container = document.getElementById('accountsList');
        container.innerHTML = data.map((account, index) => createAccountCard(account, index)).join('');
    } catch (error) {
        console.error('Error loading account summary:', error);
        showError('Failed to load account summary');
    }
}

// Create account summary card HTML for sidebar
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

    return `
        <div class="account-card account-${index}">
            <div class="account-name">
                <span class="account-indicator"></span>
                ${account.name}
            </div>
            <div class="equity-value">$${formatNumber(account.equity)}</div>
            <div class="change ${changeClass}">
                ${arrow} ${sign}$${formatNumber(Math.abs(change))} (${sign}${changePct.toFixed(2)}%)
            </div>
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
        </div>
    `;
}

// Fetch and display portfolio history charts
async function loadPortfolioHistory() {
    try {
        const response = await fetch(`/api/portfolio-history/${currentPeriod}`);
        const data = await response.json();
        
        if (data.error) {
            showError(data.error);
            return;
        }

        accountsData = data;
        renderAllCharts(data);
    } catch (error) {
        console.error('Error loading portfolio history:', error);
        showError('Failed to load portfolio history');
    }
}

// Render all metric charts
function renderAllCharts(accounts) {
    renderLineChart('pnlChart', accounts, 'pnl_pct', 'PnL %');
    renderLineChart('equityChart', accounts, 'equity', 'Equity ($)', true);
    renderLineChart('pnlDollarChart', accounts, 'pnl', 'PnL ($)', true);
    renderBarChart('volatilityChart', accounts, 'volatility', 'Volatility (%)');
    renderBarChart('sharpeChart', accounts, 'sharpe_ratio', 'Sharpe Ratio');
    renderBarChart('drawdownChart', accounts, 'max_drawdown', 'Max Drawdown (%)');
}

// Render line chart (for time series data)
function renderLineChart(canvasId, accounts, dataKey, label, isDollar = false) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    // Destroy existing chart
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    // Prepare datasets
    const datasets = accounts.map((account, index) => {
        if (account.error || !account[dataKey] || account[dataKey].length === 0) {
            return null;
        }

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

    // Use timestamps from first valid account
    const labels = accounts.find(acc => acc.timestamps && acc.timestamps.length > 0)?.timestamps || [];

    charts[canvasId] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: datasets,
        },
        options: {
            responsive: true,
            maintainAspectRatio: true,
            interaction: {
                mode: 'index',
                intersect: false,
            },
            plugins: {
                legend: {
                    display: true,
                    position: 'top',
                    labels: {
                        usePointStyle: true,
                        padding: 15,
                        color: '#1e293b',
                        font: {
                            size: 12,
                            weight: '500',
                        },
                    },
                },
                tooltip: {
                    backgroundColor: 'rgba(30, 41, 59, 0.95)',
                    padding: 12,
                    titleColor: '#ffffff',
                    bodyColor: '#ffffff',
                    borderColor: '#e2e8f0',
                    borderWidth: 1,
                    titleFont: {
                        size: 13,
                        weight: '600',
                    },
                    bodyFont: {
                        size: 12,
                    },
                    callbacks: {
                        label: function(context) {
                            const label = context.dataset.label || '';
                            const value = context.parsed.y;
                            if (isDollar) {
                                return `${label}: $${formatNumber(value)}`;
                            }
                            return `${label}: ${value.toFixed(2)}%`;
                        },
                    },
                },
            },
            scales: {
                x: {
                    display: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                    },
                    ticks: {
                        color: '#64748b',
                        maxRotation: 0,
                        minRotation: 0,
                        font: {
                            size: 10,
                        },
                        maxTicksLimit: 8,
                    },
                },
                y: {
                    display: true,
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                    },
                    ticks: {
                        color: '#64748b',
                        callback: function(value) {
                            if (isDollar) {
                                return '$' + formatNumber(value);
                            }
                            return value.toFixed(1) + '%';
                        },
                        font: {
                            size: 11,
                        },
                    },
                },
            },
        },
    });
}

// Render bar chart (for single metrics)
function renderBarChart(canvasId, accounts, metricKey, label) {
    const ctx = document.getElementById(canvasId).getContext('2d');
    
    // Destroy existing chart
    if (charts[canvasId]) {
        charts[canvasId].destroy();
    }

    // Prepare data
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
                legend: {
                    display: false,
                },
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
                    grid: {
                        display: false,
                    },
                    ticks: {
                        color: '#64748b',
                        font: {
                            size: 11,
                        },
                    },
                },
                y: {
                    grid: {
                        color: 'rgba(0, 0, 0, 0.05)',
                    },
                    ticks: {
                        color: '#64748b',
                        font: {
                            size: 11,
                        },
                    },
                },
            },
        },
    });
}

// Utility: Format numbers with commas
function formatNumber(num) {
    if (num === null || num === undefined) return '0';
    return parseFloat(num).toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}

// Update last update time
function updateLastUpdateTime() {
    const now = new Date();
    const timeString = now.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
    });
    document.getElementById('lastUpdate').textContent = timeString;
}

// Show error message
function showError(message) {
    console.error(message);
}
