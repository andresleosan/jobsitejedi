import { Link } from "react-router-dom";
import {
  Activity,
  ArrowUpRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  FileText,
  HardHat,
  MapPin,
  MoreHorizontal,
  Package,
  ShieldCheck,
  TrendingUp,
  Users,
} from "lucide-react";
import { Button } from "@/components/ui/button";

const capabilities = [
  {
    icon: Clock,
    label: "Time on site",
    title: "Capture the day while it is happening.",
    description: "Clock in, record location, and keep the work log tied to the right project.",
    tone: "blue",
  },
  {
    icon: Package,
    label: "Materials",
    title: "Know what arrived, moved, and got used.",
    description: "Keep inventory and material movements clear across every active project.",
    tone: "orange",
  },
  {
    icon: TrendingUp,
    label: "Costs",
    title: "See the budget before it becomes a surprise.",
    description: "Bring invoices and expenses into the same view as project progress.",
    tone: "blue",
  },
  {
    icon: Users,
    label: "Team access",
    title: "Give every role the right view.",
    description: "Managers, builders, and admins get focused access to the work they own.",
    tone: "orange",
  },
];

const Index = () => {
  return (
    <div className="landing-page">
      <div className="landing-shell">
        <header className="landing-header">
          <Link className="landing-brand" to="/" aria-label="BuildTrack Pro home">
            <span className="landing-brand-mark" aria-hidden="true">
              <HardHat />
            </span>
            <span>BuildTrack Pro</span>
          </Link>

          <nav className="landing-nav" aria-label="Main navigation">
            <a href="#workflow">Workflow</a>
            <a href="#capabilities">Capabilities</a>
            <Link className="landing-nav-signin" to="/auth">
              Sign in
            </Link>
            <Button asChild className="landing-nav-cta">
              <Link to="/auth">Start for free</Link>
            </Button>
          </nav>
        </header>

        <main>
          <section className="landing-hero" id="workflow" aria-labelledby="landing-title">
            <div className="landing-hero-copy">
              <p className="landing-eyebrow">
                <span className="landing-eyebrow-line" aria-hidden="true" />
                Construction operations / field + office
              </p>
              <h1 id="landing-title">Know what’s moving before the site does.</h1>
              <p className="landing-hero-lede">
                BuildTrack Pro keeps time, materials, costs, and the next handoff visible for every
                project — without asking the field team to become spreadsheet experts.
              </p>
              <div className="landing-hero-actions">
                <Button asChild className="landing-primary-action" size="lg">
                  <Link to="/auth">
                    Start your first project
                    <ArrowUpRight aria-hidden="true" />
                  </Link>
                </Button>
                <Link className="landing-text-action" to="/auth">
                  Sign in to your workspace <span aria-hidden="true">↗</span>
                </Link>
              </div>
              <div className="landing-trust-row" aria-label="BuildTrack Pro product principles">
                <span>
                  <ShieldCheck aria-hidden="true" /> Role-based access
                </span>
                <span>
                  <MapPin aria-hidden="true" /> Project-level visibility
                </span>
              </div>
            </div>

            <div className="landing-preview-wrap">
              <div className="landing-preview-pin" aria-hidden="true" />
              <div className="landing-command-card" aria-label="Illustrative project status panel">
                <div className="landing-command-topline">
                  <span className="landing-live-label">
                    <span className="landing-live-dot" aria-hidden="true" />
                    Live project pulse
                  </span>
                  <span className="landing-command-time">Today · 8:42 AM</span>
                  <MoreHorizontal className="landing-more-icon" aria-hidden="true" />
                </div>

                <div className="landing-project-heading">
                  <div>
                    <p className="landing-overline">Active project</p>
                    <h2>Northline Renovation</h2>
                    <p className="landing-project-location">
                      <MapPin aria-hidden="true" /> Seattle, WA
                    </p>
                  </div>
                  <div className="landing-project-health">
                    <strong>68%</strong>
                    <span>on track</span>
                  </div>
                </div>

                <div className="landing-progress-block">
                  <div className="landing-progress-labels">
                    <span>Current phase</span>
                    <strong>Interior rough-in</strong>
                  </div>
                  <div className="landing-progress-track" aria-hidden="true">
                    <span />
                  </div>
                </div>

                <div className="landing-activity-list">
                  <div className="landing-activity-row">
                    <span className="landing-activity-icon blue" aria-hidden="true">
                      <Users />
                    </span>
                    <span>
                      <strong>12 people on site</strong>
                      <small>Updated by the field team</small>
                    </span>
                    <span className="landing-activity-time">Now</span>
                  </div>
                  <div className="landing-activity-row">
                    <span className="landing-activity-icon orange" aria-hidden="true">
                      <Package />
                    </span>
                    <span>
                      <strong>Delivery received</strong>
                      <small>24 drywall sheets · Bay 02</small>
                    </span>
                    <span className="landing-activity-time">18m</span>
                  </div>
                  <div className="landing-activity-row">
                    <span className="landing-activity-icon green" aria-hidden="true">
                      <Check />
                    </span>
                    <span>
                      <strong>3 tasks due today</strong>
                      <small>2 complete · 1 in progress</small>
                    </span>
                    <span className="landing-activity-time">Today</span>
                  </div>
                </div>

                <div className="landing-handoff">
                  <CheckCircle2 aria-hidden="true" />
                  <span>
                    <strong>Latest handoff</strong>
                    <small>Electrical rough-in logged · 2 min ago</small>
                  </span>
                  <ArrowUpRight aria-hidden="true" />
                </div>
              </div>
              <p className="landing-preview-caption">
                <Activity aria-hidden="true" /> An illustrative view of the project signals that
                matter today.
              </p>
            </div>
          </section>

          <section className="landing-workflow-strip" aria-label="BuildTrack Pro workflow">
            <div>
              <span className="landing-strip-icon"><Activity aria-hidden="true" /></span>
              <span><strong>Capture</strong><small>the work as it happens</small></span>
            </div>
            <span className="landing-strip-arrow" aria-hidden="true">→</span>
            <div>
              <span className="landing-strip-icon"><Users aria-hidden="true" /></span>
              <span><strong>Coordinate</strong><small>the people and materials</small></span>
            </div>
            <span className="landing-strip-arrow" aria-hidden="true">→</span>
            <div>
              <span className="landing-strip-icon"><FileText aria-hidden="true" /></span>
              <span><strong>Close the loop</strong><small>with a useful record</small></span>
            </div>
          </section>

          <section className="landing-capabilities" id="capabilities" aria-labelledby="capabilities-title">
            <div className="landing-section-heading">
              <div>
                <p className="landing-eyebrow">
                  <span className="landing-eyebrow-line" aria-hidden="true" />
                  A clearer workday
                </p>
                <h2 id="capabilities-title">Every handoff leaves a useful trail.</h2>
              </div>
              <p>
                One shared record gives the office context and gives the crew fewer places to repeat
                the same update.
              </p>
            </div>

            <div className="landing-capability-layout">
              <article className="landing-featured-card">
                <div className="landing-featured-card-top">
                  <span className="landing-featured-icon"><CalendarDays aria-hidden="true" /></span>
                  <span className="landing-featured-status"><span aria-hidden="true" /> Project pulse</span>
                </div>
                <p className="landing-overline">Built for the daily handoff</p>
                <h3>Less chasing. More building.</h3>
                <p>
                  Turn scattered updates into a clear project rhythm — from the first clock-in to
                  the last invoice review.
                </p>
                <div className="landing-signal-cards" aria-label="Project pulse categories">
                  <span><strong>Time</strong><small>logged</small></span>
                  <span><strong>Materials</strong><small>tracked</small></span>
                  <span><strong>Costs</strong><small>visible</small></span>
                </div>
              </article>

              <div className="landing-capability-list">
                {capabilities.map(({ icon: Icon, label, title, description, tone }) => (
                  <article className="landing-capability-row" key={label}>
                    <span className={`landing-capability-icon ${tone}`}><Icon aria-hidden="true" /></span>
                    <div>
                      <p className="landing-overline">{label}</p>
                      <h3>{title}</h3>
                      <p>{description}</p>
                    </div>
                    <ArrowUpRight className="landing-capability-arrow" aria-hidden="true" />
                  </article>
                ))}
              </div>
            </div>
          </section>

          <section className="landing-final-cta" aria-labelledby="final-cta-title">
            <div>
              <p className="landing-overline">The next update starts here</p>
              <h2 id="final-cta-title">Bring the project into focus.</h2>
              <p>Set up a workspace for the people who keep the work moving.</p>
            </div>
            <Button asChild className="landing-cta-button" size="lg">
              <Link to="/auth">
                Start for free
                <ArrowUpRight aria-hidden="true" />
              </Link>
            </Button>
          </section>
        </main>

        <footer className="landing-footer">
          <span className="landing-footer-brand"><HardHat aria-hidden="true" /> BuildTrack Pro</span>
          <span>Project clarity for the people doing the work.</span>
          <span>© {new Date().getFullYear()} BuildTrack Pro</span>
        </footer>
      </div>
    </div>
  );
};

export default Index;
