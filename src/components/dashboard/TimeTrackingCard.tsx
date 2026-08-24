import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Clock, Play, Square } from "lucide-react";
import type { TimeEntry } from "@/lib/firebase/repositories/timeTracking";

interface TimeTrackingCardProps {
  isClockedIn: boolean;
  currentTimeEntry: TimeEntry | null;
  onClockIn: () => void;
  onClockOut: () => void;
}

const TimeTrackingCard = ({ isClockedIn, currentTimeEntry, onClockIn, onClockOut }: TimeTrackingCardProps) => {
  const [elapsedTime, setElapsedTime] = useState("");

  useEffect(() => {
    if (!isClockedIn || !currentTimeEntry) {
      setElapsedTime("");
      return;
    }

    const updateElapsed = () => {
      if (!currentTimeEntry.clockIn) return;
      const start = currentTimeEntry.clockIn.getTime();
      const now = Date.now();
      const diff = now - start;

      const hours = Math.floor(diff / (1000 * 60 * 60));
      const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((diff % (1000 * 60)) / 1000);

      setElapsedTime(`${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${seconds.toString().padStart(2, "0")}`);
    };

    updateElapsed();
    const interval = setInterval(updateElapsed, 1000);

    return () => clearInterval(interval);
  }, [isClockedIn, currentTimeEntry]);

  return (
    <Card className={isClockedIn ? "border-primary shadow-lg" : ""}>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5" />
          Time Tracking
        </CardTitle>
        <CardDescription>
          {isClockedIn ? "You are currently clocked in" : "Clock in to start tracking your time"}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {isClockedIn && elapsedTime && (
          <div className="text-center py-6">
            <div className="text-4xl font-bold text-primary font-mono">{elapsedTime}</div>
            <p className="text-sm text-muted-foreground mt-2">Hours worked today</p>
          </div>
        )}

        <Button
          onClick={isClockedIn ? onClockOut : onClockIn}
          variant={isClockedIn ? "destructive" : "default"}
          className="w-full"
          size="lg"
        >
          {isClockedIn ? (
            <>
              <Square className="h-5 w-5 mr-2" />
              Clock Out
            </>
          ) : (
            <>
              <Play className="h-5 w-5 mr-2" />
              Clock In
            </>
          )}
        </Button>
      </CardContent>
    </Card>
  );
};

export default TimeTrackingCard;
