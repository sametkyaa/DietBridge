const fs = require('fs');
const file = 'features/clients/services/clientService.ts';
let code = fs.readFileSync(file, 'utf8');

const newFetch = `
export const fetchClientDetails = async (clientId: string): Promise<Client | null> => {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return null;

    // 1. Verify dietitian-client relationship
    const { data: relation, error: relationError } = await supabase
      .from('dietitian_clients')
      .select('client_id, status')
      .eq('dietitian_id', user.id)
      .eq('client_id', clientId)
      .maybeSingle();

    if (relationError) throw relationError;
    if (!relation) {
      console.warn("No active relation found for client:", clientId);
      return null;
    }

    // 2. Fetch profile data
    const { data: userProfile, error: userProfileError } = await supabase
      .from('profiles')
      .select('id, full_name, avatar_url, email')
      .eq('id', clientId)
      .maybeSingle();

    if (userProfileError) throw userProfileError;

    // 3. Fetch client profile data
    const { data: clientProfile, error: clientProfileError } = await supabase
      .from('client_profiles')
      .select(\`
        goal,
        diet_start_date,
        current_weight,
        compliance_score,
        start_weight,
        target_weight,
        height_cm,
        last_lab_date,
        activity_level,
        sleep_hours,
        smoking_status,
        alcohol_use,
        daily_water_goal_ml,
        food_intolerances,
        chronic_conditions,
        medications,
        blood_type
      \`)
      .eq('user_id', clientId)
      .maybeSingle();

    if (clientProfileError) {
       console.warn("Client profile not found or error:", clientProfileError);
    }

    const clientData = userProfile || {};
    const profile = clientProfile || {};

    const bloodType = profile.blood_type || undefined;
    const chronicConditions = normalizeMultiValue(profile.chronic_conditions);
    const medications = normalizeMultiValue(profile.medications);
    const foodIntolerances = normalizeMultiValue(profile.food_intolerances);
    const waterGoalLiters = profile.daily_water_goal_ml ? profile.daily_water_goal_ml / 1000 : undefined;
    
    // Process sleep hours correctly
    const sleepHours = profile.sleep_hours !== null && profile.sleep_hours !== undefined 
      ? Number(profile.sleep_hours) 
      : undefined;

    return {
      id: clientId,
      name: clientData.full_name || 'İsimsiz Danışan',
      email: clientData.email || '',
      avatar: resolveProfilePhotoUrl(clientData.avatar_url) || USER_AVATAR,
      profilePhotoUrl: resolveProfilePhotoUrl(clientData.avatar_url),
      status: relation.status === 'active' ? 'Aktif' : relation.status === 'pending' ? 'Onay Bekliyor' : 'Pasif',
      goal: profile.goal || 'Sağlıklı Yaşam',
      startDate: profile.diet_start_date ? new Date(profile.diet_start_date).toLocaleDateString('tr-TR') : '-',
      duration: '1 Ay',
      currentWeight: profile.current_weight ? \`\${profile.current_weight}\` : '-',
      startWeight: profile.start_weight ? \`\${profile.start_weight}\` : undefined,
      targetWeight: profile.target_weight ? \`\${profile.target_weight}\` : undefined,
      weeklyChange: 0,
      compliance: profile.compliance_score || 0,
      bloodType,
      chronicConditions,
      medications,
      foodIntolerances,
      waterGoalLiters,
      heightCm: profile.height_cm,
      lastLabDate: profile.last_lab_date ? new Date(profile.last_lab_date).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : undefined,
      activityLevel: ACTIVITY_LABELS[profile.activity_level] || profile.activity_level || null,
      sleepHours,
      smokingStatus: SMOKING_LABELS[profile.smoking_status] || profile.smoking_status || null,
      alcoholUse: ALCOHOL_LABELS[profile.alcohol_use] || profile.alcohol_use || null,
    };
  } catch (err) {
    console.error('Error fetching client details:', err);
    throw err;
  }
};
`;

code = code.replace(/export const fetchClientDetails = async \(clientId: string\): Promise<Client \| null> => \{[\s\S]*?\n\};\n/, newFetch);

fs.writeFileSync(file, code);
