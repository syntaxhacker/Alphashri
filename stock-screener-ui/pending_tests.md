# Pending Failing Tests

**Date:** 2026-03-10  
**Total failing:** 61 tests  

## test_bots_api.py (28 tests)

- TestBotCRUD::test_list_bots_with_data
- TestBotCRUD::test_create_bot_duplicate_name
- TestBotCRUD::test_create_bot_allocation_exceeds_100_percent
- TestBotCRUD::test_create_bot_nonexistent_strategy
- TestBotCRUD::test_get_bot_success
- TestBotCRUD::test_update_bot_name
- TestBotCRUD::test_update_bot_to_duplicate_name
- TestBotCRUD::test_update_bot_strategies_allocation_validation
- TestBotCRUD::test_update_bot_not_found
- TestBotCRUD::test_delete_bot_success
- TestBotCRUD::test_delete_bot_not_found
- TestBotCRUD::test_delete_running_bot_stops_process
- TestBotControl::test_start_bot_success
- TestBotControl::test_start_bot_not_found
- TestBotControl::test_start_inactive_bot_fails
- TestBotControl::test_start_already_running_bot
- TestBotControl::test_stop_running_bot
- TestBotControl::test_stop_non_running_bot
- TestBotControl::test_get_bot_status_running
- TestBotControl::test_get_bot_status_not_running
- TestBotControl::test_get_bot_status_not_found
- TestBotControl::test_get_bot_logs_no_logs
- TestBotControl::test_get_bot_logs_with_custom_line_count
- TestAvailableStrategies::test_list_available_strategies_only_active
- TestBotPortfolioPositions::test_get_bot_portfolio_success
- TestBotPortfolioPositions::test_get_bot_positions_all
- TestBotPortfolioPositions::test_get_bot_positions_filtered_by_strategy
- TestBotPortfolioPositions::test_get_bot_scan_items
- TestBotPortfolioPositions::test_get_bot_scan_filtered_by_strategy
- TestBotPerformance::test_get_bot_performance
- TestBotPerformance::test_get_bot_performance_with_custom_days
- TestBotPerformance::test_compare_strategy_performance
- TestBotPerformance::test_get_bot_trades
- TestBotPerformance::test_get_bot_trades_filtered_by_strategy
- TestBotPerformance::test_get_bot_trades_exclude_test_data
- TestBotPerformance::test_get_strategy_performance
- TestBotPerformance::test_get_strategy_performance_with_days
- TestMultiStrategyBot::test_create_multi_strategy_bot
- TestMultiStrategyBot::test_multi_strategy_allocation_exactly_100_percent
- TestBotLifecycle::test_full_bot_lifecycle

## integration/test_bot_lifecycle.py (20 tests)

- TestBotConfigurationUpdates::test_update_bot_name
- TestBotConfigurationUpdates::test_update_bot_strategies
- TestBotConfigurationUpdates::test_update_bot_rejects_over_allocation
- TestBotCreationAndConfiguration::test_create_bot_rejects_over_allocation
- TestBotCreationAndConfiguration::test_create_bot_with_multiple_strategies
- TestBotCreationAndConfiguration::test_create_bot_with_single_strategy
- TestBotDeletionFlow::test_delete_bot_removes_strategy_associations
- TestBotDeletionFlow::test_delete_running_bot_stops_it_first
- TestBotMonitoringFlow::test_bot_logs_accessibility
- TestBotMonitoringFlow::test_bot_portfolio_tracking
- TestBotShutdownFlow::test_bot_status_after_stop
- TestBotShutdownFlow::test_bot_stop_terminates_process
- TestBotStartupFlow::test_bot_initialization_with_strategies
- TestBotStartupFlow::test_bot_startup_creates_process
- TestBotStartupFlow::test_bot_status_after_startup
- TestMultiStrategyCoordination::test_strategies_share_portfolio
- TestMultiStrategyCoordination::test_strategy_performance_tracking
- TestResourceCleanup::test_cleanup_after_bot_crash
- TestResourceCleanup::test_cleanup_on_failed_startup

## integration/test_trading_flow.py (13 tests)

- TestBotCreationFlow::test_create_bot_with_strategies
- TestBotCreationFlow::test_bot_update_flow
- TestBotLifecycleFlow::test_bot_start_stop_cycle
- TestErrorRecoveryInTrading::test_recovery_after_api_failure
- TestErrorRecoveryInTrading::test_recovery_after_order_failure
- TestMultiStrategyCoordination::test_strategy_coordination
- TestOrderPlacementFlow::test_place_order_and_create_position
- TestPnLCalculationFlow::test_end_to_end_pnl_calculation
- TestPositionManagementFlow::test_position_lifecycle
- TestSignalGenerationFlow::test_generate_signals_for_symbols
- TestStrategyCreationFlow::test_create_strategy_from_template
- TestStrategyCreationFlow::test_strategy_update_and_delete_flow
- TestTradeJournalingFlow::test_trade_journaling_lifecycle

---

## Root Causes

1. **UUID/ID mismatch**: Tests use integer `id` but code expects `uuid` strings
2. **Database fixture**: `db_session` override returning `None` causing 404s
3. **Missing user_id**: Bot queries filter by `user_id=1` but tests don't set it
4. **MagicMock misconfiguration**: Mock objects lack required fields (`uuid`, `user_id`)
5. **Floating-point validation**: Allocation rounding issues
6. **Nautilus dependency**: Missing `nautilus_trader` module in test environment (integration tests)
7. **BotResponse structure**: Missing fields (`status`, `process_id`, `error`) accessed by tests

## Suggested Actions

-Convert tests to use real database instead of extensive mocking
-Replace all integer ID references with UUIDs
-Add comprehensive nautilus_trader mocking at module level (for integration)
-Ensure BotResponse includes all required fields
-Update fixture to properly override get_db dependency