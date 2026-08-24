import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

const Dashboard = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<"manager" | "builder" | null>(null);
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!user || !user.role) {
      navigate("/auth");
      return;
    }

    setUserRole(user.role);
    setIsLoading(false);
  }, [isAuthLoading, navigate, user]);

  useEffect(() => {
    if (!isLoading && userRole) {
      if (userRole === "manager") {
        navigate("/managers");
      } else if (userRole === "builder") {
        navigate("/builders");
      }
    }
  }, [isLoading, userRole, navigate]);

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return null;
};

export default Dashboard;
