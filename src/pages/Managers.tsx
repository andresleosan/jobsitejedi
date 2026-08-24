import { useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import ManagerDashboard from "@/components/dashboard/ManagerDashboard";

const Managers = () => {
  const { user, isLoading } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (isLoading) return;
    if (!user) {
      navigate("/auth");
      return;
    }
    if (user.role !== "manager") navigate("/builders");
  }, [isLoading, navigate, user]);

  if (isLoading || !user || user.role !== "manager") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return <ManagerDashboard userId={user.id} />;
};

export default Managers;
