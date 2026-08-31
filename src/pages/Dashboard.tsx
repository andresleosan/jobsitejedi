import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { roleHomePath, type AppRole } from "@/lib/firebase/types";

const Dashboard = () => {
  const [isLoading, setIsLoading] = useState(true);
  const [userRole, setUserRole] = useState<AppRole | null>(null);
  const navigate = useNavigate();
  const { user, isLoading: isAuthLoading } = useAuth();

  useEffect(() => {
    if (isAuthLoading) return;
    if (!user) {
      navigate("/auth", { replace: true });
      return;
    }
    if (!user.role) {
      navigate("/auth?reason=missing-role", { replace: true });
      return;
    }

    setUserRole(user.role);
    setIsLoading(false);
  }, [isAuthLoading, navigate, user]);

  useEffect(() => {
    if (!isLoading && userRole) {
      navigate(roleHomePath(userRole));
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
