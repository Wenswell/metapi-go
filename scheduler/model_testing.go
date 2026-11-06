package scheduler

import (
	"context"
	"log/slog"
	"time"

	"github.com/deliciousbuding/metapi-go/config"
	"github.com/deliciousbuding/metapi-go/service"
	"github.com/deliciousbuding/metapi-go/store"
)

type ModelTestingScheduler struct {
	runner *cronRunner
	ctx    context.Context
	cancel context.CancelFunc
}

func NewModelTestingScheduler() *ModelTestingScheduler { return &ModelTestingScheduler{} }
func (s *ModelTestingScheduler) Name() string          { return "model-testing" }
func (s *ModelTestingScheduler) Start(ctx context.Context) error {
	s.ctx, s.cancel = context.WithCancel(ctx)
	s.runner = newCronRunner()
	if _, err := s.runner.addJob("0 * * * * *", s.runJob); err != nil {
		return err
	}
	s.runner.start()
	return nil
}
func (s *ModelTestingScheduler) Stop() error {
	if s.cancel != nil {
		s.cancel()
	}
	if s.runner != nil {
		s.runner.stop()
	}
	return nil
}
func (s *ModelTestingScheduler) runJob() {
	db := store.GetDB()
	if db == nil {
		return
	}
	runWithSchedulerLease(s.ctx, db, s.Name(), func() {
		plan, err := service.LoadModelTestPlan(db.DB)
		if err != nil {
			slog.Error("model-testing configuration", "error", err)
			return
		}
		now := time.Now()
		if !service.ModelTestPlanDue(plan, now) {
			return
		}
		claimed, err := service.ClaimModelTestMinute(db.DB, now)
		if err != nil {
			slog.Error("model-testing schedule claim", "error", err)
			return
		}
		if !claimed {
			return
		}
		if _, err := service.RunModelTests(s.ctx, db.DB, config.Get(), plan, "scheduled"); err != nil {
			slog.Error("model-testing scheduled run", "error", err)
		}
	})
}
