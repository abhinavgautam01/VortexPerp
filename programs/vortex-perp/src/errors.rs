use anchor_lang::prelude::*;

#[error_code]
pub enum PerpError {
    #[msg("vAMM is currently paused")]
    VammPaused,
    #[msg("Leverage must be between 1 and max_leverage")]
    InvalidLeverage,
    #[msg("Margin too small")]
    MarginTooSmall,
    #[msg("Margin plus trading fee exceeds available balance")]
    InsufficientBalanceForFee,
    #[msg("Trader already has an open position")]
    PositionAlreadyOpen,
    #[msg("Position is not liquidatable")]
    NotLiquidatable,
    #[msg("Cannot self-liquidate")]
    SelfLiquidation,
    #[msg("Funding period not elapsed yet")]
    FundingTooSoon,
    #[msg("Pyth price is stale or invalid")]
    StalePythPrice,
    #[msg("Oracle price must be positive")]
    InvalidOraclePrice,
    #[msg("Pyth confidence too wide")]
    PythConfidenceTooWide,
    #[msg("Math overflow")]
    MathOverflow,
    #[msg("Insufficient insurance fund balance")]
    InsufficientInsuranceFund,
    #[msg("Insufficient collateral vault balance")]
    InsufficientCollateralVault,
    #[msg("Invalid oracle account")]
    InvalidOracle,
    #[msg("Invalid Pyth feed ID")]
    InvalidFeedId,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Insufficient fee pool balance")]
    InsufficientFeePool,
    #[msg("New reserves deviate too far from oracle price")]
    ReservePriceDeviation,
    #[msg("Trade amount must be greater than zero")]
    InvalidAmount,
    #[msg("Trade would exhaust vAMM reserves")]
    ReserveExhaustion,
    #[msg("Position equity is zero or negative")]
    NegativeEquity,
}
